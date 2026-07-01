/** @type {import('next').NextConfig} */
const nextConfig = {
  // The mongodb driver and langchain are server-only; keep them external so
  // they aren't bundled into the client.
  serverExternalPackages: ["mongodb", "@langchain/mongodb"],
};

export default nextConfig;
