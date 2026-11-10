import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Po-russki gaplashamiz",
    short_name: "Po-russki",
    description: "Rus tilini o'rganish platformasi",
    start_url: "/home",
    scope: "/",
    display: "standalone",
    lang: "uz",
    theme_color: "#FAF7EC",
    background_color: "#FAF7EC",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
