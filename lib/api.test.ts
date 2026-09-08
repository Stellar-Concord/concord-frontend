import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEscrow, listDisputes, listEscrows } from "./api";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("api client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getEscrow requests the escrow by id", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 1, status: "created" }));

    const result = await getEscrow(1);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/escrows\/1$/);
    expect(result).toEqual({ id: 1, status: "created" });
  });

  it("listEscrows only includes params that were actually passed", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(jsonResponse([]));

    await listEscrows({ client: "GCLIENT" });

    const [url] = mockFetch.mock.calls[0];
    const parsed = new URL(url as string);
    expect(parsed.searchParams.get("client")).toBe("GCLIENT");
    expect(parsed.searchParams.has("provider")).toBe(false);
    expect(parsed.searchParams.has("status")).toBe(false);
  });

  it("listDisputes defaults to status=open", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(jsonResponse([]));

    await listDisputes();

    const [url] = mockFetch.mock.calls[0];
    expect(url).toMatch(/\/disputes\?status=open$/);
  });

  it("throws the server's error message on a non-2xx response", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: "not found" }, 404),
    );

    await expect(getEscrow(999)).rejects.toThrow("not found");
  });

  it("falls back to a generic message when the error body isn't JSON", async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      new Response("not json", { status: 500 }),
    );

    await expect(getEscrow(1)).rejects.toThrow("request failed with status 500");
  });
});
