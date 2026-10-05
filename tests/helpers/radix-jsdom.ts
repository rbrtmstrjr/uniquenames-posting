// jsdom lacks a few browser APIs that Radix (Select, Popover, Slider) calls.
export function polyfillRadix() {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
  const g = globalThis as unknown as { ResizeObserver?: unknown };
  g.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
}
