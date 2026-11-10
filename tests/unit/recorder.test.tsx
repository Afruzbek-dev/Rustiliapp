import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Recorder } from "@/components/speaking/Recorder";

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static supported = ["audio/webm;codecs=opus", "audio/mp4"];
  static isTypeSupported = (m: string) => FakeRecorder.supported.includes(m);
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(
    public stream: MediaStream,
    opts?: { mimeType?: string },
  ) {
    this.mimeType = opts?.mimeType ?? "";
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["abc"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

const trackStop = vi.fn();
const getUserMedia = vi.fn();
const fetchMock = vi.fn();

function reply(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}
const flush = () => act(async () => {});

beforeEach(() => {
  vi.useFakeTimers();
  FakeRecorder.instances = [];
  FakeRecorder.supported = ["audio/webm;codecs=opus", "audio/mp4"];
  trackStop.mockReset();
  getUserMedia.mockReset().mockResolvedValue({ getTracks: () => [{ stop: trackStop }, { stop: trackStop }] });
  fetchMock.mockReset();
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function startRecording() {
  render(<Recorder exerciseId="ex1" maxSeconds={5} />);
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "Yozishni boshlash" }));
  await flush();
}

describe("Recorder", () => {
  it("prefers webm/opus and falls back to audio/mp4", async () => {
    await startRecording();
    expect(FakeRecorder.instances[0]!.mimeType).toBe("audio/webm;codecs=opus");
    FakeRecorder.supported = ["audio/mp4"];
    document.body.innerHTML = "";
    await startRecording();
    expect(FakeRecorder.instances[1]!.mimeType).toBe("audio/mp4");
  });

  it("switches the button label and auto-stops at the limit, releasing the microphone", async () => {
    await startRecording();
    expect(screen.getByRole("button", { name: "Yozishni to'xtatish" })).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(FakeRecorder.instances[0]!.state).toBe("recording");
    expect(screen.getByText("00:04")).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(FakeRecorder.instances[0]!.state).toBe("inactive");
    expect(trackStop).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Yuborish" })).toBeInTheDocument();
    expect(screen.getByLabelText("Yozuvni tinglash")).toBeInTheDocument();
  });

  it("shows a clear state when microphone permission is denied", async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error("x"), { name: "NotAllowedError" }));
    await startRecording();
    expect(screen.getByRole("alert")).toHaveTextContent("Mikrofonga ruxsat berilmadi");
    expect(FakeRecorder.instances).toHaveLength(0);
  });

  it("shows an unsupported-browser state without MediaRecorder", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    render(<Recorder exerciseId="ex1" />);
    await flush();
    expect(screen.getByText("Brauzer qo'llab-quvvatlamaydi")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Yozishni boshlash" })).toBeNull();
  });

  it("stops the stream tracks on unmount while recording", async () => {
    render(<Recorder exerciseId="ex1" />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Yozishni boshlash" }));
    await flush();
    screen.getByRole("button", { name: "Yozishni to'xtatish" });
    cleanup();
    expect(trackStop).toHaveBeenCalledTimes(2);
    expect(FakeRecorder.instances[0]!.state).toBe("inactive");
  });

  it("retries after an upload failure without creating a second submission", async () => {
    await startRecording();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    reply({ submissionId: "s1", uploadUrl: "https://up.test/u", token: "t" });
    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 })); // PUT fails
    fireEvent.click(screen.getByRole("button", { name: "Yuborish" }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("Yozuvni yuklab bo'lmadi");

    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 })); // PUT ok
    reply({ ok: true });
    fireEvent.click(screen.getByRole("button", { name: "Qayta yuborish" }));
    await flush();
    expect(screen.getByText("Yuborildi")).toBeInTheDocument();
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toEqual([
      "/api/submissions/audio-upload",
      "https://up.test/u",
      "https://up.test/u",
      "/api/submissions/audio-complete",
    ]);
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({
      exerciseId: "ex1",
      mime: "audio/webm",
    });
    expect(JSON.parse((fetchMock.mock.calls[3]![1] as RequestInit).body as string)).toEqual({ submissionId: "s1" });
  });

  it("maps a rate-limit answer to an Uzbek message and 'Qayta yozish' resets", async () => {
    await startRecording();
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    reply({ error: "rate_limited" }, 429);
    fireEvent.click(screen.getByRole("button", { name: "Yuborish" }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("Juda ko'p urinish");
    fireEvent.click(screen.getByRole("button", { name: /Qayta yozish/ }));
    expect(screen.getByRole("button", { name: "Yozishni boshlash" })).toBeInTheDocument();
  });
});
