import { describe, expect, it } from "vitest";
import { messagesFor, ruleIds } from "../helpers.js";

/** A one-service file whose `ports:` body is provided by the test. */
function portsFixture(ports: string): string {
  return [
    "name: qa",
    "services:",
    "  web:",
    "    image: nginx:1.27",
    `    ports:${ports}`,
    '    healthcheck: { test: ["CMD", "true"] }',
    "",
  ].join("\n");
}

/** no-unbound-ports messages for a `ports:` body. */
function portMessages(ports: string): string[] {
  return messagesFor(portsFixture(ports), "no-unbound-ports");
}

/** A one-service file with `image:` provided by the test. */
function imageFixture(image: string): string {
  return [
    "name: qa",
    "services:",
    "  web:",
    `    image: ${image}`,
    '    healthcheck: { test: ["CMD", "true"] }',
    "",
  ].join("\n");
}

describe("no-privileged no-privileged", () => {
  it("reports privileged: true", () => {
    expect(
      ruleIds("services:\n  web:\n    image: nginx:1\n    privileged: true\n"),
    ).toContain("no-privileged");
  });

  it("passes without privileged", () => {
    expect(ruleIds("services:\n  web:\n    image: nginx:1\n")).not.toContain(
      "no-privileged",
    );
  });
});

describe("no-host-network no-host-network", () => {
  it("reports network_mode: host", () => {
    expect(
      ruleIds(
        "services:\n  web:\n    image: nginx:1\n    network_mode: host\n",
      ),
    ).toContain("no-host-network");
  });
});

describe("no-cap-add-all no-cap-add-all", () => {
  it("reports cap_add ALL", () => {
    expect(
      ruleIds(
        "services:\n  web:\n    image: nginx:1\n    cap_add:\n      - ALL\n",
      ),
    ).toContain("no-cap-add-all");
  });

  it("passes with specific capabilities", () => {
    expect(
      ruleIds(
        "services:\n  web:\n    image: nginx:1\n    cap_add:\n      - NET_ADMIN\n",
      ),
    ).not.toContain("no-cap-add-all");
  });
});

describe("no-unbound-ports no-unbound-ports", () => {
  it("reports unbound port", () => {
    expect(
      ruleIds(
        "services:\n  web:\n    image: nginx:1\n    ports:\n      - '8080:80'\n",
      ),
    ).toContain("no-unbound-ports");
  });

  it("passes with bound port", () => {
    expect(
      ruleIds(
        "services:\n  web:\n    image: nginx:1\n    ports:\n      - '127.0.0.1:8080:80'\n",
      ),
    ).not.toContain("no-unbound-ports");
  });
});

describe("image-require-tag image-require-tag", () => {
  it("reports image without tag", () => {
    expect(ruleIds("services:\n  web:\n    image: nginx\n")).toContain(
      "image-require-tag",
    );
  });

  it("reports latest tag", () => {
    expect(ruleIds("services:\n  web:\n    image: nginx:latest\n")).toContain(
      "image-require-tag",
    );
  });

  it("passes with explicit tag", () => {
    expect(
      ruleIds("services:\n  web:\n    image: nginx:1.27-alpine\n"),
    ).not.toContain("image-require-tag");
  });

  it("handles registry with port", () => {
    expect(
      ruleIds(
        "services:\n  web:\n    image: registry.example.com:5000/app:v1\n",
      ),
    ).not.toContain("image-require-tag");
  });

  // With `build`, `image` names the artifact Compose produces, so there is no
  // registry reference to pin. Real projects use this to tag a local build
  // (`image: sentry-self-hosted-local`), and reporting it was noise.
  it("ignores an image that names a local build", () => {
    for (const build of ["build: .", "build:\n      context: ."]) {
      expect(
        ruleIds(`services:\n  web:\n    image: app-local\n    ${build}\n`),
      ).not.toContain("image-require-tag");
    }
  });

  it("ignores a built image inherited through an anchor", () => {
    const source = [
      "name: qa",
      "x-built: &built",
      "  build: .",
      "services:",
      "  web:",
      "    <<: *built",
      "    image: app-local",
      '    healthcheck: { test: ["CMD", "true"] }',
      "",
    ].join("\n");
    expect(ruleIds(source)).not.toContain("image-require-tag");
  });
});

describe("no-unbound-ports published ports", () => {
  it("reports a host port with no address", () => {
    expect(portMessages('\n      - "3000:3000"')).toEqual([
      'Service "web": port "3000:3000" is published on all interfaces (0.0.0.0)',
    ]);
  });

  it("reports an explicit 0.0.0.0 binding", () => {
    expect(portMessages('\n      - "0.0.0.0:3000:3000"')).toEqual([
      'Service "web": port "0.0.0.0:3000:3000" is published on all interfaces (0.0.0.0)',
    ]);
  });

  it("reports the IPv6 wildcard", () => {
    expect(portMessages('\n      - "[::]:4000:4000"')).toHaveLength(1);
  });

  it("reports a port range", () => {
    expect(portMessages('\n      - "8000-8010:8000-8010"')).toHaveLength(1);
  });

  it("reports a wildcard binding in the long syntax", () => {
    expect(
      portMessages(
        '\n      - target: 80\n        published: "8080"\n        protocol: tcp',
      ),
    ).toEqual([
      'Service "web": port "8080" is published on all interfaces (0.0.0.0)',
    ]);
  });

  it("reports an explicit wildcard host_ip in the long syntax", () => {
    expect(
      portMessages(
        '\n      - target: 80\n        published: "8080"\n        host_ip: 0.0.0.0',
      ),
    ).toHaveLength(1);
  });

  it("accepts a loopback binding", () => {
    expect(portMessages('\n      - "127.0.0.1:3000:3000"')).toEqual([]);
  });

  it("accepts a loopback binding with a protocol", () => {
    expect(portMessages('\n      - "127.0.0.1:3000:3000/udp"')).toEqual([]);
  });

  it("accepts a bracketed IPv6 address", () => {
    expect(portMessages('\n      - "[::1]:4000:4000"')).toEqual([]);
  });

  it("accepts a bound host_ip in the long syntax", () => {
    expect(
      portMessages(
        '\n      - target: 80\n        published: "8080"\n        host_ip: 127.0.0.1',
      ),
    ).toEqual([]);
  });

  it("ignores a container-only port", () => {
    expect(portMessages('\n      - "3000"')).toEqual([]);
    expect(portMessages("\n      - 3000")).toEqual([]);
  });

  it("ignores a long syntax entry that publishes nothing", () => {
    expect(portMessages("\n      - target: 80\n        mode: host")).toEqual(
      [],
    );
  });

  it("reports the protocol form on all interfaces", () => {
    expect(portMessages('\n      - "3000:3000/udp"')).toHaveLength(1);
  });
});

describe("no-privileged privileged", () => {
  function messages(value: string): string[] {
    return messagesFor(
      [
        "name: qa",
        "services:",
        "  web:",
        "    image: nginx:1.27",
        '    healthcheck: { test: ["CMD", "true"] }',
        `    privileged: ${value}`,
        "",
      ].join("\n"),
      "no-privileged",
    );
  }

  it("reports the boolean form", () => {
    expect(messages("true")).toEqual([
      'Service "web": privileged mode grants full access to the host',
    ]);
  });

  it("reports the quoted form Compose also accepts", () => {
    expect(messages('"true"')).toHaveLength(1);
    expect(messages('"TRUE"')).toHaveLength(1);
  });

  it("accepts a disabled flag", () => {
    expect(messages("false")).toEqual([]);
    expect(messages('"false"')).toEqual([]);
  });

  it("does not report an uninterpolated variable", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: Compose interpolation literal
    expect(messages("${PRIVILEGED}")).toEqual([]);
  });
});

describe("image-require-tag image references", () => {
  function messages(image: string): string[] {
    return messagesFor(imageFixture(image), "image-require-tag");
  }

  it("reports a bare repository name", () => {
    expect(messages("nginx")).toHaveLength(1);
  });

  it("reports implicit tags regardless of case", () => {
    expect(messages("nginx:latest")).toHaveLength(1);
    expect(messages("nginx:LATEST")).toHaveLength(1);
    expect(messages("nginx:stable")).toHaveLength(1);
  });

  it("accepts a digest as a pin", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    expect(messages(`nginx@${digest}`)).toEqual([]);
    expect(messages(`nginx:1.27@${digest}`)).toEqual([]);
  });

  it("handles a registry with a port", () => {
    expect(messages("registry.example.com:5000/app")).toHaveLength(1);
    expect(messages("registry.example.com:5000/app:1.2.3")).toEqual([]);
    expect(messages("localhost:5000/team/app:latest")).toHaveLength(1);
  });

  it("does not guess about an interpolated image reference", () => {
    // biome-ignore-start lint/suspicious/noTemplateCurlyInString: Compose interpolation literals
    expect(messages("${IMAGE}")).toEqual([]);
    expect(messages("${REGISTRY}/${APP}")).toEqual([]);
  });

  it("still requires a tag when only the registry is interpolated", () => {
    expect(messages("${REGISTRY}/app")).toHaveLength(1);
  });

  it("accepts an interpolated tag", () => {
    expect(messages("nginx:${TAG}")).toEqual([]);
  });
  // biome-ignore-end lint/suspicious/noTemplateCurlyInString: end of literals
});
