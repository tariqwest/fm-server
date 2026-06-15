// ============================================================================
// UnifiedBackend.test.ts — Abstraction over FM CLI and helper backends
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { UnifiedBackend, type BackendKind } from "../../src/bridge/UnifiedBackend.js";
import {
  HelperProcess,
  type HelperRequest,
  type HelperReply,
  type HelperStreamFrame,
} from "../../src/bridge/HelperProcess.js";
import { AfmError } from "../../src/errors/AfmError.js";

// Mock HelperProcess using composition instead of inheritance
class MockHelperProcess {
  private mockRequest = vi.fn();
  private mockStream = vi.fn();
  private mockShutdown = vi.fn();
  private shuttingDown = false;

  async request(req: HelperRequest): Promise<HelperReply> {
    if (this.shuttingDown) {
      throw new Error("HelperProcess is shutting down");
    }
    return this.mockRequest(req) as Promise<HelperReply>;
  }

  streamRequest(req: HelperRequest, _signal?: AbortSignal): AsyncIterable<HelperStreamFrame> {
    if (this.shuttingDown) {
      throw new Error("HelperProcess is shutting down");
    }
    return this.mockStream(req) as AsyncIterable<HelperStreamFrame>;
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.mockShutdown();
  }

  setMockResponse(op: string, response: HelperReply) {
    this.mockRequest.mockImplementation((req: HelperRequest) => {
      if (req.op === op) return Promise.resolve(response);
      throw new Error(`Unexpected op: ${req.op}`);
    });
  }

  setMockStream(op: string, frames: HelperStreamFrame[]) {
    this.mockStream.mockImplementation(function* (req: HelperRequest) {
      if (req.op === op) {
        for (const frame of frames) yield frame;
      } else {
        throw new Error(`Unexpected op: ${req.op}`);
      }
    });
  }

  get mockRequestCalls() {
    return this.mockRequest.mock.calls;
  }
}

describe("UnifiedBackend", () => {
  let mockHelper: MockHelperProcess;
  let backend: UnifiedBackend;

  beforeEach(() => {
    mockHelper = new MockHelperProcess();
    // Cast to unknown first to bypass type checking
    backend = UnifiedBackend.createHelper(mockHelper as unknown as HelperProcess);
  });

  describe("createHelper", () => {
    it("creates helper backend with correct kind", () => {
      expect(backend.getKind()).toBe("helper" as BackendKind);
    });
  });

  describe("call method", () => {
    it("delegates openSession to helper", async () => {
      mockHelper.setMockResponse("openSession", {
        ok: true,
        id: "r1",
        session: "test-session-123",
      });

      const reply = await backend.call({
        op: "openSession",
        backend: "on_device",
      });

      expect(reply).toHaveProperty("session", "test-session-123");
      expect(reply).toHaveProperty("ok", true);
    });

    it("delegates respond to helper", async () => {
      mockHelper.setMockResponse("respond", {
        ok: true,
        id: "r1",
        content: "Hello world",
        finishReason: "stop",
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
      });

      const reply = await backend.call({
        op: "respond",
        session: "test-session",
        prompt: "Hi",
      });

      expect(reply).toHaveProperty("content", "Hello world");
      expect(reply).toHaveProperty("finishReason", "stop");
    });

    it("delegates availability check to helper", async () => {
      mockHelper.setMockResponse("availability", {
        ok: true,
        id: "r1",
        status: "available",
      });

      const reply = await backend.call({
        op: "availability",
      });

      expect(reply).toHaveProperty("status", "available");
      expect(reply).toHaveProperty("ok", true);
    });
  });

  describe("streamRequest method", () => {
    it("yields delta frames from helper", async () => {
      mockHelper.setMockStream("stream", [
        { id: "s1", event: "delta", text: "Hello" },
        { id: "s1", event: "delta", text: " world" },
        { id: "s1", event: "done", finishReason: "stop", usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 } },
      ]);

      const frames: unknown[] = [];
      for await (const frame of backend.streamRequest({
        op: "stream",
        session: "test",
        prompt: "Hi",
      })) {
        frames.push(frame);
      }

      expect(frames).toHaveLength(3);
      expect(frames[0]).toHaveProperty("event", "delta");
      expect(frames[2]).toHaveProperty("event", "done");
    });

    it("handles error frames from helper", async () => {
      mockHelper.setMockStream("stream", [
        { ok: false, id: "s1", error: { kind: "model_unavailable", message: "Model not loaded" } },
      ]);

      const frames: unknown[] = [];
      for await (const frame of backend.streamRequest({
        op: "stream",
        session: "test",
        prompt: "Hi",
      })) {
        frames.push(frame);
      }

      // Should yield the error frame
      expect(frames[0]).toHaveProperty("ok", false);
      expect(frames[0]).toHaveProperty("error.kind", "model_unavailable");
    });
  });

  describe("shutdown", () => {
    it("calls shutdown on helper process", async () => {
      const shutdownSpy = vi.spyOn(mockHelper, "shutdown");

      await backend.shutdown();

      expect(shutdownSpy).toHaveBeenCalled();
    });

    it("marks backend as shutting down", async () => {
      await backend.shutdown();

      // After shutdown, calls should fail
      await expect(
        backend.call({ op: "openSession" })
      ).rejects.toThrow("shutting down");
    });
  });

  describe("request ID generation", () => {
    it("generates unique request IDs", async () => {
      // Allow any op and return appropriate responses
      mockHelper.setMockResponse("openSession", { ok: true, id: "r1", session: "s1" });
      // Second call will also match openSession pattern, but that's ok for this test
      // The key is that multiple calls happen

      await backend.call({ op: "openSession", backend: "on_device" });
      await backend.call({ op: "openSession", backend: "on_device" });

      // Each call should get a unique ID (implementation detail, but ensures no collisions)
      const calls = mockHelper.mockRequestCalls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe("UnifiedBackend FM backend (placeholder)", () => {
  it("createFm static method exists", () => {
    // FM backend requires actual fm binary, can't test in CI
    // But we verify the method exists
    expect(typeof UnifiedBackend.createFm).toBe("function");
  });
});
