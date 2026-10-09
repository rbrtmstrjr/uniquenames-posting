import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { geminiVoiceClip, pcmToWav, toWav, TTS_MODEL } from "@/lib/ai/tts";

const KEY = "test-key-SECRET-123";
const fetchMock = vi.fn();
const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;
const audioReply = (mimeType: string, bytes: Buffer) =>
  reply(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType, data: bytes.toString("base64") } }] } }] });

beforeEach(() => {
  process.env.GEMINI_API_KEY = KEY;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("pcmToWav / toWav", () => {
  it("wraps 16-bit PCM in a 44-byte header (24 kHz mono)", () => {
    const pcm = Buffer.alloc(480, 1);
    const wav = pcmToWav(pcm);
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.subarray(8, 12).toString()).toBe("WAVE");
    expect(wav.readUInt32LE(4)).toBe(36 + 480);
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt32LE(28)).toBe(48000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(480);
    expect(wav.length).toBe(44 + 480);
  });

  it("audio/wav passes through untouched (no second header)", () => {
    const file = pcmToWav(Buffer.alloc(100));
    expect(toWav("audio/wav", file)).toBe(file);
  });

  it("audio/L16 gets a header at the rate in the mime type", () => {
    const wav = toWav("audio/L16;codec=pcm;rate=16000", Buffer.alloc(64))!;
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.length).toBe(108);
  });

  it("refuses an unknown type or a 'wav' that is not RIFF", () => {
    expect(toWav("audio/mpeg", Buffer.alloc(10))).toBeNull();
    expect(toWav("audio/wav", Buffer.from("not a wav file"))).toBeNull();
  });
});

describe("geminiVoiceClip", () => {
  it("asks the TTS model for audio in the voice; the key goes in a header, never the URL", async () => {
    const file = pcmToWav(Buffer.alloc(2000, 3));
    fetchMock.mockResolvedValueOnce(audioReply("audio/wav", file));
    const r = await geminiVoiceClip("Gacrux", "Hello, mama.");
    expect(r).toEqual({ ok: true, wav: file });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/models/${TTS_MODEL}:generateContent`);
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
    const body = JSON.parse(init.body as string);
    expect(body.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Gacrux");
    expect(body.contents[0].parts[0].text).toBe("Hello, mama.");
  });

  it("wraps raw PCM (older models) as 24 kHz mono WAV", async () => {
    fetchMock.mockResolvedValueOnce(audioReply("audio/L16;codec=pcm;rate=24000", Buffer.alloc(4800, 7)));
    const r = await geminiVoiceClip("Kore", "x");
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.wav.subarray(0, 4).toString()).toBe("RIFF"); expect(r.wav.readUInt32LE(24)).toBe(24000); expect(r.wav.length).toBe(4844); }
  });

  it("no key: fails without calling Gemini", async () => {
    delete process.env.GEMINI_API_KEY;
    expect(await geminiVoiceClip("Kore", "x")).toEqual({ ok: false, error: "GEMINI_API_KEY is not set." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries once on 429/5xx, then reports the error", async () => {
    fetchMock.mockResolvedValue(reply(503, { error: { message: "overloaded" } }));
    const r = await geminiVoiceClip("Kore", "x");
    expect(r).toEqual({ ok: false, error: "Gemini error 503: overloaded" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a 400 (bad voice) is not retried", async () => {
    fetchMock.mockResolvedValue(reply(400, { error: { message: "No matching speaker voice found for name: Nope" } }));
    const r = await geminiVoiceClip("Nope", "x");
    expect(r.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("no audio part / blocked / unknown format are clear errors", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { candidates: [{ content: { parts: [{ text: "hi" }] }, finishReason: "OTHER" }] }));
    expect(await geminiVoiceClip("Kore", "x")).toEqual({ ok: false, error: "Gemini returned no audio (OTHER)." });
    fetchMock.mockResolvedValueOnce(reply(200, { promptFeedback: { blockReason: "SAFETY" } }));
    expect(await geminiVoiceClip("Kore", "x")).toEqual({ ok: false, error: "Gemini blocked the request (SAFETY)." });
    fetchMock.mockResolvedValueOnce(audioReply("audio/mpeg", Buffer.alloc(100)));
    expect((await geminiVoiceClip("Kore", "x")).ok).toBe(false);
  });

  it("a network error is retried once; the key never reaches the error or the console", async () => {
    const spies = [vi.spyOn(console, "error").mockImplementation(() => {}), vi.spyOn(console, "log").mockImplementation(() => {}), vi.spyOn(console, "warn").mockImplementation(() => {})];
    fetchMock.mockRejectedValue(new TypeError(`fetch failed ${KEY}`));
    const r = await geminiVoiceClip("Kore", "x");
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const s of spies) { expect(JSON.stringify(s.mock.calls)).not.toContain(KEY); s.mockRestore(); }
  });
});
