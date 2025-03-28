import { getContainerRenderer as getMDXRenderer } from "@astrojs/mdx";
import rss from "@astrojs/rss";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getCollection } from "astro:content";
import fs from "fs";
import { imageSizeFromFile } from "image-size/fromFile";
import mime from "mime-types";
import { join } from "path";
import { SITE_DESCRIPTION, SITE_TITLE } from "../consts";

/**
 *
 * @param {import("astro").APIContext} context
 * @returns
 */
export async function GET(context) {
  const renderers = await loadRenderers([getMDXRenderer()]);
  const container = await AstroContainer.create({ renderers });
  const posts = await getCollection("blog");
  const items = [];
  for (const post of posts.sort((a, b) => b.data.pubDate - a.data.pubDate)) {
    /** @type {import("@astrojs/rss").RSSFeedItem} */
    const feedItem = {
      title: post.data.title,
      pubDate: post.data.pubDate,
      description: post.data.description,
      categories: post.data.tags,
      link: `/blog/${post.slug}/`,
      author: "Kalle Fagerberg",
    };
    const heroImage = post.data.heroImage;
    if (heroImage) {
      const url = new URL(heroImage, context.site);
      const path = join("public", heroImage);
      const dimensions = await imageSizeFromFile(path);
      const mimeType = mime.lookup(heroImage);
      feedItem.customData = `<media:content
							type="${mimeType}"
							width="${dimensions.width}"
							height="${dimensions.height}"
							medium="image"
							url="${url}"
						/>`;
      const stat = fs.statSync(path);
      feedItem.enclosure = {
        length: stat.size,
        type: mimeType,
        url: url.toString(),
      };
      feedItem.content = `<img
							src="${url}"
							width="${dimensions.width}"
							height="${dimensions.height}"
							style="max-width: calc(min(100%, 480px)); height: auto; display: block;"
						/>`;
    }

    feedItem.content += `
			<h1>${feedItem.title}</h1>
    `;

    const { Content } = await post.render();
    const content = await container.renderToString(Content);
    feedItem.content += content;

    items.push(feedItem);
  }
  return rss({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    site: context.site,
    xmlns: {
      media: "http://search.yahoo.com/mrss/",
      atom: "http://www.w3.org/2005/Atom",
    },
    stylesheet: "/public/pretty-feed-v3.xsl",
    customData: `<image>
			<url>${new URL("favicon.svg", context.site)}</url>
			<title>${SITE_TITLE}</title>
			<link>${context.site}</link>
		</image>
		<atom:link
			href="${context.site}rss.xml"
			rel="self"
			type="application/rss+xml"
		/>`,
    items: items,
  });
}
