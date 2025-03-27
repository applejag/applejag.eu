import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import svelte from "@astrojs/svelte";
import addClasses from "rehype-class-names";
import rehypeAttrs from "rehype-attr";
import tailwindcss from "@tailwindcss/vite";

// https://astro.build/config
export default defineConfig({
  site: "https://applejag.eu",
  integrations: [mdx(), sitemap(), svelte()],

  markdown: {
    rehypePlugins: [
      [
        addClasses,
        {
          a: "anchor",
          h1: "h1 my-8 border-b-4",
          h2: "h2 my-8 border-b-4 border-indigo-500",
          h3: "h3 my-8",
          h4: "h4 my-8",
          h5: "h5 my-8",
          code: "code break-words whitespace-break-spaces",
          kbd: "kbd",
          blockquote: "blockquote",
          p: "my-4",
          ul: "ul",
          img: "mx-auto h-auto max-w-full rounded-lg shadow-lg",
        },
      ],
      [
        rehypeAttrs,
        {
          properties: "attr",
        },
      ],
    ],
  },

  vite: {
    plugins: [tailwindcss()],
  },
});
