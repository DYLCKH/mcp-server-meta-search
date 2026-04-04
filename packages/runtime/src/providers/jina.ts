import { z } from "zod";
import { httpUrlSchema } from "@meta-search/shared";
import type { KeyPool } from "../key-pool.js";
import type { FetchResponse } from "../http-client.js";
import { callWithKeyRotation, callSingleRequest } from "../http-client.js";

export const TOOL_NAME = "fetch_jina_markdown";

export const TOOL_DEFINITION = {
  title: "Fetch Jina Markdown",
  description:
    "Fetch a webpage as Markdown via Jina Reader. Try this first for most public pages; if the content is incomplete or the page needs real browser rendering / JavaScript execution, use fetch_as_markdown next.",
  inputSchema: {
    url: httpUrlSchema.describe("The absolute http(s) URL of the webpage to fetch as Markdown."),
    wait_for_selector: z
      .string()
      .min(1)
      .optional()
      .describe("Optional CSS selector to wait for before extraction. If the selector never appears, the request may fail upstream."),
    target_selector: z
      .string()
      .min(1)
      .optional()
      .describe("Optional CSS selector limiting extraction to a specific part of the page. Use this to focus on the main content area."),
    remove_selector: z
      .string()
      .min(1)
      .optional()
      .describe("Optional CSS selector to remove from the page before extraction, such as nav, ads, or cookie banners."),
  },
  annotations: {
    readOnlyHint: true,
  },
} as const;

export interface JinaHandlerDeps {
  baseUrl: string;
  keyPool: KeyPool;
  timeoutMs: number;
  maxAttempts: number;
  onKeyRevoked: (providerName: string, index: number, key: unknown, error: Error) => void;
}

export function createJinaHandler(deps: JinaHandlerDeps) {
  const timeoutSeconds = Math.max(1, Math.min(180, Math.ceil(deps.timeoutMs / 1000)));
  const fixedHeaders: Record<string, string> = {
    Accept: "text/plain",
    "Content-Type": "application/json",
    "X-Respond-With": "markdown",
    "X-Retain-Images": "none",
    "X-Retain-Links": "text",
    "X-Cache-Tolerance": "3600",
    "X-Timeout": String(timeoutSeconds),
    DNT: "1",
  };

  return async function fetchJinaMarkdown(input: Record<string, unknown>) {
    const headers: Record<string, string> = { ...fixedHeaders };

    if (input.wait_for_selector) {
      headers["X-Wait-For-Selector"] = input.wait_for_selector as string;
    }
    if (input.target_selector) {
      headers["X-Target-Selector"] = input.target_selector as string;
    }
    if (input.remove_selector) {
      headers["X-Remove-Selector"] = input.remove_selector as string;
    }

    const buildRequest = (apiKey?: unknown) => ({
      url: `${deps.baseUrl}/`,
      init: {
        method: "POST",
        headers: apiKey
          ? { ...headers, Authorization: `Bearer ${apiKey}` }
          : headers,
        body: JSON.stringify({ url: input.url }),
      },
    });

    const extractData = (result: FetchResponse) => result.rawText;

    const response = deps.keyPool.hasKeys()
      ? await callWithKeyRotation({
          providerName: "jina",
          keyPool: deps.keyPool,
          timeoutMs: deps.timeoutMs,
          configuredMaxAttempts: deps.maxAttempts,
          onKeyRevoked: deps.onKeyRevoked,
          buildRequest: (key) => buildRequest(key),
          extractData,
        })
      : await callSingleRequest({
          providerName: "jina",
          timeoutMs: deps.timeoutMs,
          buildRequest: () => buildRequest(),
          extractData,
        });

    const markdown = typeof response.data === "string" ? response.data : "";
    const normalized = {
      provider: "jina_reader",
      attempts: response.attempts,
      url: input.url,
      authenticated: deps.keyPool.hasKeys(),
    };

    return {
      content: [{ type: "text" as const, text: markdown }],
      structuredContent: normalized,
    };
  };
}
