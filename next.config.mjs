/** @type {import('next').NextConfig} */
const nextConfig = {
  // Native / WASM modules must be resolved by Node at runtime, not bundled.
  serverExternalPackages: ["pg", "@electric-sql/pglite", "sharp", "manifold-3d", "three-mesh-bvh"],
  // Files read at runtime must be shipped with the serverless functions.
  outputFileTracingIncludes: {
    "/**": ["./drizzle/**/*", "./node_modules/manifold-3d/**/*", "./node_modules/@electric-sql/pglite/dist/**/*"],
  },
};
export default nextConfig;
