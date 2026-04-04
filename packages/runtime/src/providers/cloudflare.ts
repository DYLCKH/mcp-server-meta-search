import { z } from "zod";
import {
  compactObject,
  optionalIntSchema,
  optionalNumSchema,
  optionalBoolSchema,
  optionalHttpUrlSchema,
} from "@meta-search/shared";
import type { KeyPool } from "../key-pool.js";
import { callWithKeyRotation } from "../http-client.js";

export const TOOL_NAME = "fetch_as_markdown";

export const TOOL_DEFINITION = {
  title: "Fetch as Markdown (Cloudflare Browser Fallback)",
  description:
    "Browser-rendered Markdown fallback via Cloudflare. " +
    "Use this after fetch_jina_markdown when content is missing, login-gated, or requires real browser rendering / JavaScript execution.",
  inputSchema: z.object({
    url: optionalHttpUrlSchema.describe("The absolute http(s) URL of the webpage to convert to Markdown. Required unless html is provided."),
    html: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Raw HTML to convert directly (alternative to url). Provide either html or url. When html is provided, url is ignored by the API.",
      ),
    cacheTTL: optionalIntSchema(z.number().int().min(0).max(86400))
      .describe(
        "Cache TTL in seconds (0 to disable, max 86400). Default: 5. Passed as query parameter.",
      ),
    gotoOptions: z
      .object({
        waitUntil: z
          .enum(["load", "domcontentloaded", "networkidle0", "networkidle2"])
          .optional()
          .describe(
            "When to consider navigation complete. Use 'networkidle0' or 'networkidle2' for JS-heavy pages.",
          ),
        timeout: optionalIntSchema(z.number().int().min(0).max(60000))
          .describe("Max navigation time in ms (max 60000)."),
      })
      .optional()
      .describe("Navigation options controlling page load behavior."),
    waitForSelector: z
      .object({
        selector: z
          .string()
          .min(1)
          .describe("CSS selector to wait for before extraction."),
        visible: optionalBoolSchema().describe("Wait until element is visible."),
        hidden: optionalBoolSchema().describe("Wait until element is hidden."),
        timeout: optionalIntSchema(z.number().int().min(0).max(60000))
          .describe("Max wait time for selector in ms."),
      })
      .optional()
      .describe("Wait for a specific CSS selector before extraction."),
    rejectRequestPattern: z
      .array(z.string())
      .optional()
      .describe(
        'Regex patterns for request URLs to block (e.g. ["/^.*\\\\.(css)/"]).',
      ),
    rejectResourceTypes: z
      .array(z.string())
      .optional()
      .describe('Resource types to block (e.g. ["image", "stylesheet"]).'),
    allowRequestPattern: z
      .array(z.string())
      .optional()
      .describe("Regex patterns for allowed request URLs (whitelist)."),
    allowResourceTypes: z
      .array(z.string())
      .optional()
      .describe("Resource types to allow (whitelist)."),
    cookies: z
      .array(
        z.object({
          name: z.string().describe("Cookie name."),
          value: z.string().describe("Cookie value."),
          domain: z.string().optional().describe("Cookie domain."),
          path: z.string().optional().describe("Cookie path."),
          secure: optionalBoolSchema().describe("Secure flag."),
          httpOnly: optionalBoolSchema().describe("HttpOnly flag."),
        }),
      )
      .optional()
      .describe("Cookies to set before navigation."),
    authenticate: z
      .object({
        username: z.string().describe("HTTP Basic Auth username."),
        password: z.string().describe("HTTP Basic Auth password."),
      })
      .optional()
      .describe("HTTP Basic Auth credentials."),
    setExtraHTTPHeaders: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Custom HTTP headers as key-value pairs (e.g. {"Authorization": "Bearer token"}).',
      ),
    viewport: z
      .object({
        width: optionalIntSchema(z.number().int()).describe("Viewport width in pixels."),
        height: optionalIntSchema(z.number().int()).describe("Viewport height in pixels."),
        deviceScaleFactor: optionalNumSchema(z.number()).describe("Device scale factor (DPR)."),
      })
      .optional()
      .describe("Browser viewport dimensions."),
    userAgent: z
      .string()
      .optional()
      .describe("Custom User-Agent string for the request."),
    addScriptTag: z
      .array(
        z.object({
          content: z
            .string()
            .optional()
            .describe("Inline JavaScript code."),
          url: z
            .string()
            .optional()
            .describe("URL to external JS file."),
        }),
      )
      .optional()
      .describe("JavaScript tags to inject before rendering."),
    addStyleTag: z
      .array(
        z.object({
          content: z.string().optional().describe("Inline CSS rules."),
          url: z
            .string()
            .optional()
            .describe("URL to external CSS file."),
        }),
      )
      .optional()
      .describe("CSS tags to inject before rendering."),
    setJavaScriptEnabled: optionalBoolSchema().describe("Enable/disable JavaScript execution (default: true)."),
  }).superRefine((input, ctx) => {
    if (!input.url && !input.html) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: "Provide either url or html.",
      });
    }
  }),
  annotations: {
    readOnlyHint: true,
  },
} as const;

export interface CloudflareHandlerDeps {
  baseUrl: string;
  keyPool: KeyPool;
  timeoutMs: number;
  maxAttempts: number;
  onKeyRevoked: (providerName: string, index: number, key: unknown, error: Error) => void;
}

interface CloudflareCredential {
  accountId: string;
  token: string;
}

export function createCloudflareHandler(deps: CloudflareHandlerDeps) {
  return async function fetchAsMarkdown(input: Record<string, unknown>) {
    if (!deps.keyPool.hasKeys()) {
      throw new Error(
        "cloudflare: no credentials configured. Add accounts to config.jsonc.",
      );
    }

    const queryParams =
      input.cacheTTL !== undefined ? `?cacheTTL=${input.cacheTTL}` : "";

    const payload = compactObject({
      url: input.url,
      html: input.html,
      gotoOptions: input.gotoOptions,
      waitForSelector: input.waitForSelector,
      rejectRequestPattern: input.rejectRequestPattern,
      rejectResourceTypes: input.rejectResourceTypes,
      allowRequestPattern: input.allowRequestPattern,
      allowResourceTypes: input.allowResourceTypes,
      cookies: input.cookies,
      authenticate: input.authenticate,
      setExtraHTTPHeaders: input.setExtraHTTPHeaders,
      viewport: input.viewport,
      userAgent: input.userAgent,
      addScriptTag: input.addScriptTag,
      addStyleTag: input.addStyleTag,
      setJavaScriptEnabled: input.setJavaScriptEnabled,
    });

    const { data, attempts } = await callWithKeyRotation({
      providerName: "cloudflare",
      keyPool: deps.keyPool,
      timeoutMs: deps.timeoutMs,
      configuredMaxAttempts: deps.maxAttempts,
      onKeyRevoked: deps.onKeyRevoked,
      buildRequest: (cred) => {
        const c = cred as CloudflareCredential;
        return {
          url: `${deps.baseUrl}/accounts/${c.accountId}/browser-rendering/markdown${queryParams}`,
          init: {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${c.token}`,
            },
            body: JSON.stringify(payload),
          },
        };
      },
    });

    // Cloudflare response envelope: { success: true, result: "markdown string" }
    const response = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const markdown =
      typeof response.result === "string"
        ? response.result
        : typeof data === "string"
          ? data
          : "";

    const normalized = {
      provider: "cloudflare_browser_rendering",
      attempts,
      success: response.success ?? null,
      url: input.url,
      markdown,
    };

    return {
      content: [
        {
          type: "text" as const,
          text: markdown || JSON.stringify(normalized, null, 2),
        },
      ],
      structuredContent: normalized,
    };
  };
}
