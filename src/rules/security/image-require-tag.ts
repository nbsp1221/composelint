import type { Rule, RuleContext } from "../../core/types.js";
import { reportServiceValue } from "../report.js";

const IMPLICIT_TAGS = ["latest", "stable", "edge", "canary"];

export const imageRequireTag: Rule = {
  meta: {
    name: "image-require-tag",
    category: "security",
    description: "Images should use an explicit tag instead of implicit latest",
    fixable: false,
    defaultSeverity: "warn",
    options: { forbiddenTags: "string[]" },
  },
  create(context: RuleContext) {
    const document = context.document;
    const forbidden =
      (context.options.forbiddenTags as string[] | undefined) ?? IMPLICIT_TAGS;

    for (const name of document.getMergedServiceNames()) {
      const image = document.getMergedServiceValue(name, "image");
      if (typeof image !== "string" || image === "") continue;

      // With `build` present, Compose builds the image and applies `image` as
      // the tag for the result. The reference is a label for a local artifact,
      // not a dependency pulled from a registry, so pinning it says nothing
      // about reproducibility — the Dockerfile decides that.
      if (document.getMergedServiceKeys(name).includes("build")) continue;

      // Handle registry with port: registry.example.com:5000/app
      const lastSlash = image.lastIndexOf("/");
      const namePart = lastSlash === -1 ? image : image.slice(lastSlash + 1);

      // `image: ${IMAGE}` may already carry a tag; Compose resolves it later.
      if (namePart.includes("${")) continue;

      const colonIndex = namePart.lastIndexOf(":");

      if (colonIndex === -1) {
        reportServiceValue(
          context,
          name,
          ["image"],
          `Service "${name}": image "${image}" has no explicit tag (defaults to "latest")`,
        );
        continue;
      }

      const tag = namePart.slice(colonIndex + 1);
      if (!forbidden.includes(tag.toLowerCase())) continue;

      reportServiceValue(
        context,
        name,
        ["image"],
        `Service "${name}": image "${image}" uses implicit tag "${tag}"`,
      );
    }
  },
};
