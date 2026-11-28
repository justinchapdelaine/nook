// The inference host: serves client requests with one engine, through the
// scheduler. It runs in the offscreen document's worker; the document
// relays each client port's messages here, tagged with the port's id.
import type { ModelBuild } from "../models";
import { FAMILIES, findFamily, pickBuild } from "../models";
import { CancelledError, Scheduler, type Ticket } from "../scheduler";
import type { Engine } from "./engine";
import { HostError } from "./engine";
import type { ClientMessage, HostMessage, HostRequest, HostResults, ModelStatus } from "./protocol";
import { HEARTBEAT_MS } from "./protocol";

type Send = (message: HostMessage) => void;

export function createHost(engine: Engine, onBusyChange: (busy: boolean) => void) {
  const scheduler = new Scheduler(onBusyChange);
  /** Open tickets by port, then request id, so a closed port's work can be cancelled. */
  const open = new Map<number, Map<number, Ticket<unknown>>>();
  let loaded: ModelBuild | undefined;
  let f16: Promise<boolean> | undefined;
  /** Downloads by family, each with the clients following its progress. */
  type Progress = (text: string, fraction: number) => void;
  const downloads = new Map<string, { result: Promise<null>; followers: Set<Progress> }>();

  const hasF16 = () => {
    f16 ??= engine.hasF16().catch((error: unknown) => {
      f16 = undefined;
      throw error;
    });
    return f16;
  };

  const familyOf = (id: string) => {
    const family = findFamily(id);
    if (!family) throw new Error(`Unknown model ${id}`);
    return family;
  };
  const buildFor = async (id: string) => pickBuild(familyOf(id), await hasF16());

  async function load(build: ModelBuild, progress: Progress): Promise<void> {
    if (loaded?.id === build.id) return;
    loaded = undefined;
    await engine.load(build, progress);
    loaded = build;
  }

  /**
   * Starts a family's download, or joins the one under way. Cancelling only
   * stops following it: the user asked for the download, and a page closing
   * (or WebLLM, which can't stop a load part-way) shouldn't waste it.
   */
  function download(family: string, send: Send, id: number): Ticket<null> {
    let entry = downloads.get(family);
    if (!entry) {
      const followers = new Set<Progress>();
      const result = scheduler.add({
        priority: "user",
        run: async () => {
          await load(await buildFor(family), (text, fraction) => {
            for (const follow of followers) follow(text, fraction);
          });
          return null;
        },
      }).result;
      entry = { result, followers };
      downloads.set(family, entry);
      void result.then(
        () => downloads.delete(family),
        () => downloads.delete(family),
      );
    }
    const follow: Progress = (text, fraction) => send({ id, kind: "progress", text, fraction });
    const { followers } = entry;
    followers.add(follow);
    let stopped!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      stopped = () => reject(new CancelledError());
    });
    return {
      result: Promise.race([entry.result, cancelled]).finally(() => followers.delete(follow)),
      cancel: stopped,
    };
  }

  function job(request: HostRequest, send: Send, id: number): Ticket<unknown> {
    switch (request.type) {
      case "models": {
        // Only reads the cache, so it skips the GPU queue: the settings page shouldn't wait
        // behind a download or a reply to show its status.
        const result = (async () => {
          const f16 = await hasF16();
          return Promise.all(
            FAMILIES.map(async (family): Promise<ModelStatus> => {
              const build = pickBuild(family, f16);
              const downloaded = await engine.isCached(build);
              return { family: family.id, build: build.id, downloaded, downloading: downloads.has(family.id) };
            }),
          );
        })();
        return { result, cancel() {} };
      }
      case "download":
        return download(request.family, send, id);
      case "delete":
        return scheduler.add({
          priority: "user",
          run: async () => {
            const family = familyOf(request.family);
            if (loaded && family.builds.some((b) => b.id === loaded?.id)) {
              await engine.unload();
              loaded = undefined;
            }
            for (const build of family.builds) await engine.remove(build);
            return null;
          },
        });
      case "generate": {
        const { family, priority, ...rest } = request.request;
        return scheduler.add({
          priority,
          run: async (signal, attempt): Promise<HostResults["generate"]> => {
            if (attempt > 0) send({ id, kind: "restart" });
            const build = await buildFor(family);
            if (loaded?.id !== build.id) {
              // Translation never downloads; the user agrees to that on the settings page.
              if (!(await engine.isCached(build)))
                throw new HostError("not-downloaded", `${familyOf(family).label} isn't downloaded yet`);
              await load(build, (text, fraction) => send({ id, kind: "progress", text, fraction }));
            }
            // Cancelled or preempted while the model loaded: don't start the reply.
            if (signal.aborted) return { finishReason: "abort" };
            try {
              return await engine.generate(rest, (text) => send({ id, kind: "delta", text }), signal);
            } catch (error) {
              // A failed reply (for example a lost GPU device) can leave the engine without
              // its pipeline, so load the model again next time rather than trust it.
              loaded = undefined;
              throw error;
            }
          },
        });
      }
      default: {
        // A client from another version of the extension can send a type this host doesn't know.
        const type = (request as { type?: unknown }).type;
        return { result: Promise.reject(new Error(`Unknown request: ${String(type)}`)), cancel() {} };
      }
    }
  }

  /** Handles one message from a client port. */
  function receive(portId: number, message: ClientMessage, send: Send): void {
    const tickets = open.get(portId) ?? new Map<number, Ticket<unknown>>();
    open.set(portId, tickets);
    const { id } = message;
    if ("cancel" in message) {
      tickets.get(id)?.cancel();
      return;
    }
    const heartbeat = setInterval(() => send({ id, kind: "alive" }), HEARTBEAT_MS);
    const ticket = job(message.request, send, id);
    tickets.set(id, ticket);
    ticket.result
      .then(
        (result) => send({ id, kind: "result", result }),
        (error: unknown) => {
          if (error instanceof CancelledError) send({ id, kind: "error", error: error.message, code: "cancelled" });
          else if (error instanceof HostError) send({ id, kind: "error", error: error.message, code: error.code });
          else send({ id, kind: "error", error: error instanceof Error ? error.message : String(error) });
        },
      )
      .finally(() => {
        clearInterval(heartbeat);
        tickets.delete(id);
      });
  }

  /** A client port closed: cancel what it was waiting for, since nobody will read the result. */
  function disconnected(portId: number): void {
    for (const ticket of open.get(portId)?.values() ?? []) ticket.cancel();
    open.delete(portId);
  }

  return { receive, disconnected };
}
