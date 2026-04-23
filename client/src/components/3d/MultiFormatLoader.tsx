import { useMemo, useEffect, useState, useRef } from "react";
import { useGLTF, Center, Html } from "@react-three/drei";
import * as THREE from "three";
import { loadCadFromUrl } from "./StepLoader";
import type { ViewMode } from "./ModelViewer";
import Icon from "../../components/shared/Icon";

interface MultiFormatLoaderProps {
  url: string;
  viewMode: ViewMode;
  showDimensions: boolean;
  clipEnabled: boolean;
  clipDirection: "x" | "y" | "z";
  clipPosition: number;
  materialPreset: "metal" | "plastic" | "glass" | "default";
  onLoaded?: () => void;
}

// Generate a simple environment map for metallic reflections
let _envMap: THREE.Texture | null = null;
function getEnvMap(): THREE.Texture {
  if (_envMap) return _envMap;
  const pmrem = new THREE.PMREMGenerator();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd0d8e8);
  // Add gradient lights for reflection
  const l1 = new THREE.DirectionalLight(0xffffff, 3);
  l1.position.set(5, 8, 5);
  scene.add(l1);
  const l2 = new THREE.DirectionalLight(0x8899bb, 2);
  l2.position.set(-5, 3, -5);
  scene.add(l2);
  const l3 = new THREE.HemisphereLight(0xc8e0ff, 0x886633, 2);
  scene.add(l3);
  _envMap = pmrem.fromScene(scene, 0.04).texture;
  pmrem.dispose();
  return _envMap;
}

function createMaterial(preset: string): THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial {
  const envMap = getEnvMap();
  switch (preset) {
    case "metal":
      return new THREE.MeshStandardMaterial({ color: 0xe8e8ec, metalness: 0.95, roughness: 0.15, envMap, envMapIntensity: 1.5 });
    case "plastic":
      return new THREE.MeshStandardMaterial({ color: 0x4499ff, metalness: 0.0, roughness: 0.35, envMap, envMapIntensity: 0.4 });
    case "glass":
      return new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.0, roughness: 0.0, transmission: 0.95, thickness: 0.5, ior: 1.5, envMap, envMapIntensity: 0.8 });
    default:
      return new THREE.MeshStandardMaterial({ color: 0xc8cad0, metalness: 0.5, roughness: 0.3, envMap, envMapIntensity: 1.0 });
  }
}

function getModelFormat(url: string): string {
  const ext = url.split(".").pop()?.toLowerCase() || "";
  return ext;
}

const CAD_FORMATS = new Set(["step", "stp", "iges", "igs"]);

function CadModel({
  url,
  viewMode,
  showDimensions,
  clipEnabled,
  clipDirection,
  clipPosition,
  materialPreset,
  onLoaded,
}: MultiFormatLoaderProps) {
  const [cadGroup, setCadGroup] = useState<THREE.Group | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Cache base material — only recreate when preset changes
  const baseMaterial = useMemo(() => createMaterial(materialPreset), [materialPreset]);

  useEffect(() => {
    let cancelled = false;
    loadCadFromUrl(url)
      .then((group) => {
        if (!cancelled) {
          setCadGroup(group);
          onLoaded?.();
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "模型加载失败");
      });
    return () => { cancelled = true; };
  }, [url, onLoaded]);

  useEffect(() => {
    if (!cadGroup) return;

    const clipPlane = new THREE.Plane(
      new THREE.Vector3(
        clipDirection === "x" ? -1 : 0,
        clipDirection === "y" ? -1 : 0,
        clipDirection === "z" ? -1 : 0
      ),
      clipPosition
    );

    cadGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (!child.userData.originalMaterial) {
          child.userData.originalMaterial = child.material;
        }

        // Only create new material when preset changes
        if (child.userData._matPreset !== materialPreset) {
          child.material = materialPreset !== "default"
            ? baseMaterial.clone()
            : child.userData.originalMaterial;
          child.userData._matPreset = materialPreset;
        }

        if (clipEnabled) {
          child.material.clippingPlanes = [clipPlane];
          child.material.side = THREE.DoubleSide;
        } else {
          child.material.clippingPlanes = [];
        }

        if (viewMode === "wireframe") {
          child.material.wireframe = true;
        } else if (viewMode === "transparent") {
          child.material.transparent = true;
          child.material.opacity = 0.3;
          child.material.wireframe = false;
        } else {
          child.material.wireframe = false;
          child.material.transparent = false;
          child.material.opacity = 1;
        }

        child.material.needsUpdate = true;
      }
    });
  }, [cadGroup, viewMode, clipEnabled, clipDirection, clipPosition, materialPreset, baseMaterial]);

  if (error) {
    return (
      <Html center>
        <div className="flex flex-col items-center gap-3 text-center">
          <Icon name="error" size={56} className="text-error/60" />
          <p className="text-sm text-error max-w-xs">{error}</p>
        </div>
      </Html>
    );
  }

  if (!cadGroup) {
    return (
      <Html center>
        <div className="flex flex-col items-center gap-3">
          <Icon name="view_in_ar" size={48} className="text-on-surface-variant/30 animate-pulse" />
          <span className="text-xs text-on-surface-variant">解析 CAD 模型...</span>
        </div>
      </Html>
    );
  }

  const box = new THREE.Box3().setFromObject(cadGroup);

  return (
    <group>
      <primitive object={cadGroup} />
      {showDimensions && box && (
        <group>
          <DimensionLine start={new THREE.Vector3(box.min.x, box.min.y, box.min.z)} end={new THREE.Vector3(box.max.x, box.min.y, box.min.z)} label={`${((box.max.x - box.min.x) * 1000).toFixed(1)} mm`} />
          <DimensionLine start={new THREE.Vector3(box.min.x, box.min.y, box.min.z)} end={new THREE.Vector3(box.min.x, box.max.y, box.min.z)} label={`${((box.max.y - box.min.y) * 1000).toFixed(1)} mm`} />
          <DimensionLine start={new THREE.Vector3(box.min.x, box.min.y, box.min.z)} end={new THREE.Vector3(box.min.x, box.min.y, box.max.z)} label={`${((box.max.z - box.min.z) * 1000).toFixed(1)} mm`} />
        </group>
      )}
    </group>
  );
}

function GltfModel({
  url,
  viewMode,
  showDimensions,
  clipEnabled,
  clipDirection,
  clipPosition,
  materialPreset,
  onLoaded,
}: MultiFormatLoaderProps) {
  const { scene } = useGLTF(url);

  const clonedScene = useMemo(() => scene.clone(true), [scene]);
  const box = useMemo(() => new THREE.Box3().setFromObject(clonedScene), [clonedScene]);

  // Cache base material — only recreate when preset changes
  const baseMaterial = useMemo(() => createMaterial(materialPreset), [materialPreset]);

  // Auto-adjust camera to fit the model
  useEffect(() => {
    if (!box || box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim === 0) return;
    // Dispatch custom event for CameraController to pick up
    window.dispatchEvent(new CustomEvent("model-loaded", {
      detail: { center: { x: center.x, y: center.y, z: center.z }, size: maxDim }
    }));
  }, [box]);

  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  useEffect(() => {
    const t = setTimeout(() => onLoadedRef.current?.(), 0);
    return () => clearTimeout(t);
  }, []);

  const clipPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0), []);

  useEffect(() => {
    if (clipEnabled) {
      const normal = new THREE.Vector3(
        clipDirection === "x" ? -1 : 0,
        clipDirection === "y" ? -1 : 0,
        clipDirection === "z" ? -1 : 0
      );
      clipPlane.set(normal, clipPosition);
    }

    clonedScene.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        // Only create new material when preset changes
        if (child.userData._matPreset !== materialPreset) {
          child.material = baseMaterial.clone();
          child.userData._matPreset = materialPreset;
        }
        if (clipEnabled) {
          child.material.clippingPlanes = [clipPlane];
          child.material.side = THREE.DoubleSide;
        } else {
          child.material.clippingPlanes = [];
        }
        if (viewMode === "wireframe") {
          child.material.wireframe = true;
        } else if (viewMode === "transparent") {
          child.material.transparent = true;
          child.material.opacity = 0.3;
          child.material.wireframe = false;
        } else {
          child.material.wireframe = false;
          child.material.transparent = false;
          child.material.opacity = 1;
        }
        child.material.needsUpdate = true;
      }
    });
  }, [viewMode, clipEnabled, clipDirection, clipPosition, clipPlane, materialPreset, baseMaterial, clonedScene]);

  useEffect(() => {
    if (viewMode !== "explode" || !box) return;
    const center = box.getCenter(new THREE.Vector3());
    const meshes: THREE.Mesh[] = [];
    clonedScene.traverse((child) => { if (child instanceof THREE.Mesh) meshes.push(child); });
    meshes.forEach((mesh) => {
      if (!mesh.userData.originalPosition) mesh.userData.originalPosition = mesh.position.clone();
      const meshBox = new THREE.Box3().setFromObject(mesh);
      const meshCenter = meshBox.getCenter(new THREE.Vector3());
      const direction = meshCenter.clone().sub(center).normalize();
      mesh.position.copy(mesh.userData.originalPosition);
      mesh.position.add(direction.multiplyScalar(1.5));
    });
  }, [viewMode, box, clonedScene]);

  const positions = useMemo(() => {
    if (!box) return null;
    return {
      x: new Float32Array([box.min.x, box.min.y, box.min.z, box.max.x, box.min.y, box.min.z]),
      y: new Float32Array([box.min.x, box.min.y, box.min.z, box.min.x, box.max.y, box.min.z]),
      z: new Float32Array([box.min.x, box.min.y, box.min.z, box.min.x, box.min.y, box.max.z]),
    };
  }, [box]);

  return (
    <group>
      <Center>
        <primitive object={clonedScene} />
      </Center>
      {showDimensions && box && positions && (
        <group>
          <DimensionLine start={new THREE.Vector3(box.min.x, box.min.y, box.min.z)} end={new THREE.Vector3(box.max.x, box.min.y, box.min.z)} label={`${((box.max.x - box.min.x) * 1000).toFixed(1)} mm`} />
          <DimensionLine start={new THREE.Vector3(box.min.x, box.min.y, box.min.z)} end={new THREE.Vector3(box.min.x, box.max.y, box.min.z)} label={`${((box.max.y - box.min.y) * 1000).toFixed(1)} mm`} />
          <DimensionLine start={new THREE.Vector3(box.min.x, box.min.y, box.min.z)} end={new THREE.Vector3(box.min.x, box.min.y, box.max.z)} label={`${((box.max.z - box.min.z) * 1000).toFixed(1)} mm`} />
        </group>
      )}
    </group>
  );
}

function DimensionLine({ start, end, label }: { start: THREE.Vector3; end: THREE.Vector3; label: string }) {
  const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  const length = start.distanceTo(end);
  const dir = new THREE.Vector3().subVectors(end, start).normalize();
  // Offset labels slightly outward to avoid overlapping with model
  const offset = 0.02 * length;
  const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const labelOffset = new THREE.Vector3().crossVectors(dir, up).normalize().multiplyScalar(offset);
  const labelPos = mid.clone().add(labelOffset);

  const positions = useMemo(
    () => new Float32Array([start.x, start.y, start.z, end.x, end.y, end.z]),
    [start, end]
  );

  return (
    <group>
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} count={2} />
        </bufferGeometry>
        <lineBasicMaterial color="#00e5ff" linewidth={2} />
      </line>
      {/* End markers */}
      <mesh position={start}>
        <sphereGeometry args={[length * 0.008, 8, 8]} />
        <meshBasicMaterial color="#00e5ff" />
      </mesh>
      <mesh position={end}>
        <sphereGeometry args={[length * 0.008, 8, 8]} />
        <meshBasicMaterial color="#00e5ff" />
      </mesh>
      <Html position={[labelPos.x, labelPos.y, labelPos.z]} center distanceFactor={8}>
        <div className="bg-[#00e5ff]/20 text-[#00e5ff] text-[11px] px-2 py-0.5 rounded font-mono whitespace-nowrap border border-[#00e5ff]/50 pointer-events-none backdrop-blur-sm">
          {label}
        </div>
      </Html>
    </group>
  );
}

function XtServerConverter({ url, ...props }: MultiFormatLoaderProps) {
  const [status, setStatus] = useState<"idle" | "converting" | "done" | "error">("idle");
  const [gltfUrl, setGltfUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function convert() {
      setStatus("converting");
      try {
        const response = await fetch("/api/models/convert-xt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.detail || "转换请求失败");
        }
        const data = await response.json();
        if (!cancelled) {
          setGltfUrl(data.gltf_url);
          setStatus("done");
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : "转换失败");
          setStatus("error");
        }
      }
    }
    convert();
    return () => { cancelled = true; };
  }, [url]);

  if (status === "converting") {
    return (
      <Html center>
        <div className="flex flex-col items-center gap-3">
          <Icon name="autorenew" size={48} className="text-primary-container/60 animate-spin" />
          <span className="text-xs text-on-surface-variant">正在转换 Parasolid (.x_t) 格式...</span>
        </div>
      </Html>
    );
  }

  if (status === "error") {
    return (
      <Html center>
        <div className="flex flex-col items-center gap-3 text-center max-w-sm">
          <Icon name="error" size={56} className="text-error/60" />
          <p className="text-xs text-error">{errorMsg}</p>
          <p className="text-xs text-on-surface-variant">请先将文件上传至服务器进行转换，或转换为 STEP 格式后重试。</p>
        </div>
      </Html>
    );
  }

  if (status === "done" && gltfUrl) {
    return <GltfModel {...props} url={gltfUrl} />;
  }

  return null;
}

export default function MultiFormatLoader(props: MultiFormatLoaderProps) {
  const format = getModelFormat(props.url);

  if (format === "xt" || format === "x_t" || format === "xmt_txt") {
    return <XtServerConverter {...props} url={props.url} />;
  }

  if (format === "glb" || format === "gltf") {
    return <GltfModel {...props} />;
  }

  if (CAD_FORMATS.has(format)) {
    return (
      <Center>
        <CadModel {...props} />
      </Center>
    );
  }

  return <GltfModel {...props} />;
}
