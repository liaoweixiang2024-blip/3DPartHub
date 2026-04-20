declare module "occt-import-js" {
  interface MeshAttribute {
    array: ArrayLike<number>;
  }

  interface MeshData {
    index?: { array: ArrayLike<number> };
    attributes: {
      position: MeshAttribute;
      normal?: MeshAttribute;
    };
    color?: [number, number, number];
    name?: string;
  }

  interface OcctResult {
    meshes: MeshData[];
  }

  interface OcctModule {
    locateFile?: (name: string) => string;
  }

  interface OcctInstance {
    ReadStepFile: (buffer: Uint8Array, params: null) => OcctResult;
    ReadIgesFile: (buffer: Uint8Array, params: null) => OcctResult;
  }

  export default function occtimportjs(moduleArg?: OcctModule): Promise<OcctInstance>;
}
