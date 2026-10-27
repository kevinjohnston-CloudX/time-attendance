import sanitizeHtml from "sanitize-html";

/**
 * A Knowledge Base article's HTML, made safe to draw inside CloudTime.
 *
 * <p>The articles are written in our ticketing system's editor, by our own
 * staff, but they are still HTML from another system, so nothing in them runs
 * here: scripts, event handlers and any address other than http(s) or a page
 * of ours are removed, and only the tags articles use are kept (text,
 * headings, lists, tables, pictures with captions, videos, and video players
 * from the three sites the editor allows).
 *
 * <p>Two things change on the way, both so the article belongs to this page:
 * a link to another article (/go/kb/<id>) opens that article here, and the
 * colours and font sizes the editor writes inline are dropped, so captions
 * follow this app's own type and work in dark mode.
 */

const VIDEO_HOSTS = ["www.youtube.com", "youtube.com", "www.youtube-nocookie.com", "player.vimeo.com", "www.loom.com"];
// Layout only: sizes and spacing the editor sets on pictures and videos.
const LAYOUT = [/^\d+(\.\d+)?(px|%|rem|em)?$|^auto$|^0$/];
const LAYOUT_LIST = [/^[\d.]+(px|%|rem|em)?( [\d.]+(px|%|rem|em)?|( auto)){0,3}$|^0$|^auto$/];

export function cleanArticleHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "hr", "strong", "b", "em", "i", "u", "s", "sub", "sup", "mark", "code", "pre", "blockquote",
      "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li",
      "a", "img", "figure", "figcaption", "video", "source", "iframe",
      "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
      "span", "div", "details", "summary",
    ],
    // The article's own title is the page heading, so a heading inside it
    // starts one level down.
    transformTags: {
      h1: "h2",
      a: (tagName, attribs): sanitizeHtml.Tag => {
        const href = attribs.href ?? "";
        const article = href.match(/^(?:https?:\/\/[^/]+)?\/go\/kb\/([A-Za-z0-9_-]{1,64})\/?$/);
        if (article) return { tagName, attribs: { href: `/knowledge-base/${article[1]}` } };
        if (/^https?:\/\//i.test(href)) return { tagName, attribs: { href, target: "_blank", rel: "noopener noreferrer" } };
        return { tagName, attribs: { href } };
      },
      img: (tagName, attribs) => ({ tagName, attribs: { ...attribs, loading: "lazy" } }),
    },
    allowedAttributes: {
      a: ["href", "target", "rel"],
      img: ["src", "alt", "width", "height", "loading", "style"],
      figure: ["style"],
      video: ["src", "poster", "controls", "playsinline", "preload", "width", "height", "style", "aria-label"],
      source: ["src", "type"],
      iframe: ["src", "width", "height", "allow", "allowfullscreen", "frameborder", "title", "style"],
      th: ["colspan", "rowspan", "style"],
      td: ["colspan", "rowspan", "style"],
      col: ["span"],
      p: ["style"],
      div: ["style"],
      span: ["style"],
    },
    allowedStyles: {
      "*": {
        "text-align": [/^(left|right|center|justify)$/],
        width: LAYOUT,
        "max-width": LAYOUT,
        height: LAYOUT,
        margin: LAYOUT_LIST,
        "margin-left": LAYOUT,
        "margin-right": LAYOUT,
        "margin-top": LAYOUT,
        "border-radius": LAYOUT,
        "aspect-ratio": [/^\d+(\.\d+)?( ?\/ ?\d+(\.\d+)?)?$/],
        display: [/^(block|inline-block)$/],
      },
    },
    allowedSchemes: ["http", "https"],
    allowedSchemesByTag: { a: ["http", "https", "mailto", "tel"] },
    allowProtocolRelative: false,
    allowedIframeHostnames: VIDEO_HOSTS,
    allowIframeRelativeUrls: false,
  });
}
