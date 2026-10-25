declare module 'heic-decode' {
  interface HeicDecoded {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }

  interface HeicHandle {
    width: number;
    height: number;
    decode(): Promise<HeicDecoded>;
  }

  interface HeicHandles extends Array<HeicHandle> {
    dispose(): void;
  }

  function decode(input: { buffer: Uint8Array }): Promise<HeicDecoded>;

  namespace decode {
    function all(input: { buffer: Uint8Array }): Promise<HeicHandles>;
  }

  export = decode;
}
