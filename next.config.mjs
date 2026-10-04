/** @type {import('next').NextConfig} */
const nextConfig = {
  // Native / WASM modules must be resolved by Node at runtime, not bundled.
  serverExternalPackages: ["better-sqlite3", "sharp", "manifold-3d", "three-mesh-bvh"],
  experimental: { serverActions: { bodySizeLimit: "50mb" } },
};
export default nextConfig;
