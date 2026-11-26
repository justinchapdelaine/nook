// WebGPU adapter details, as reported in the calling context.
import type { GpuInfo } from "./protocol";

export async function gpuInfo(): Promise<GpuInfo> {
  try {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return { available: false, error: navigator.gpu ? "No adapter" : "No navigator.gpu" };
    const info = adapter.info;
    const limits: Record<string, number> = {};
    for (const key of ["maxBufferSize", "maxStorageBufferBindingSize", "maxComputeWorkgroupStorageSize"] as const) {
      limits[key] = adapter.limits[key];
    }
    return {
      available: true,
      vendor: info.vendor,
      architecture: info.architecture,
      device: info.device,
      description: info.description,
      isFallbackAdapter: (info as { isFallbackAdapter?: boolean }).isFallbackAdapter ?? false,
      features: [...adapter.features].sort(),
      limits,
    };
  } catch (error) {
    return { available: false, error: String(error) };
  }
}
