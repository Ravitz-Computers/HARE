// openrgb-sdk's published package.json points "types" at a path that
// doesn't exist in the tarball (a known upstream packaging bug — the real
// .d.ts files sit in dist/, not types/). We type the API surface we
// actually use ourselves in openrgbBackend.ts and cast the dynamic import,
// so this just needs to satisfy the module resolver.
declare module "openrgb-sdk";
