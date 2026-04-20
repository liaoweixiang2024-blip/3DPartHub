import { useMemo, useEffect } from "react";
import { useGLTF, Html, Center } from "@react-three/drei";
import * as THREE from "three";
import type { ViewMode } from "./ModelViewer";

interface ModelLoaderProps {
  url: string;
  viewMode: ViewMode;
  showDimensions: boolean;
  clipEnabled: boolean;
  clipDirection: "x" | "y" | "z";
  clipPosition: number;
  materialPreset: "metal" | "plastic" | "glass" | "default";
  onLoaded?: () => void;
  onProgress?: (progress: number) => void;
}

function createMaterial(preset: string): THREE.MeshStandardMaterial {
  switch (preset) {
    case "metal":
      return new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.9, roughness: 0.15 });
    case "plastic":
      return new THREE.MeshStandardMaterial({ color: 0x3388ff, metalness: 0.0, roughness: 0.4 });
    case "glass":
      return new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.0, roughness: 0.0, transmission: 0.95, thickness: 0.5, ior: 1.5 });
    default:
      return new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.3, roughness: 0.5 });
  }
}

function DimensionMarker({ start, end, label, axis }: { start: THREE.Vector3; end: THREE.Vector3; label: string; axis: "x" | "y" | "z" }) {
  const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  const offset = axis === "x" ? new THREE.Vector3(0, -0.3, 0) : axis === "y" ? new THREE.Vector3(-0.3, 0, 0) : new THREE.Vector3(0, -0.3, 0);
  const pos = mid.add(offset);

  const positions = useMemo(() => new Float32Array([start.x, start.y, start.z, end.x, end.y, end.z]), [start, end]);

  return (
    <group>
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} count={2} />
        </bufferGeometry>
        <lineBasicMaterial color="#f97316" linewidth={1} />
      </line>
      <Html position={[pos.x, pos.y, pos.z]} center distanceFactor={8}>
        <div className="bg-black/80 text-orange-400 text-[10px] px-2 py-0.5 rounded font-mono whitespace-nowrap border border-orange-500/30 pointer-events-none">
          {label}
        </div>
      </Html>
    </group>
  );
}

export default function ModelLoader({
  url,
  viewMode,
  showDimensions,
  clipEnabled,
  clipDirection,
  clipPosition,
  materialPreset,
  onLoaded,
}: ModelLoaderProps) {
  const { scene } = useGLTF(url);

  const clonedScene = useMemo(() => {
    return scene.clone(true);
  }, [scene]);

  const box = useMemo(() => {
    return new THREE.Box3().setFromObject(clonedScene);
  }, [clonedScene]);

  useEffect(() => {
    onLoaded?.();
  }, [onLoaded]);

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
        if (!child.userData.originalMaterial) {
          child.userData.originalMaterial = child.material;
        }

        child.material = materialPreset !== "default" ? createMaterial(materialPreset) : child.userData.originalMaterial;

        if (clipEnabled) {
          child.material.clippingPlanes = [clipPlane];
          child.material.clipShadows = true;
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
  }, [viewMode, clipEnabled, clipDirection, clipPosition, clipPlane, materialPreset, clonedScene]);

  useEffect(() => {
    if (viewMode !== "explode" || !box) return;

    const center = box.getCenter(new THREE.Vector3());
    const meshes: THREE.Mesh[] = [];
    clonedScene.traverse((child) => {
      if (child instanceof THREE.Mesh) meshes.push(child);
    });

    meshes.forEach((mesh) => {
      if (!mesh.userData.originalPosition) {
        mesh.userData.originalPosition = mesh.position.clone();
      }
      const meshBox = new THREE.Box3().setFromObject(mesh);
      const meshCenter = meshBox.getCenter(new THREE.Vector3());
      const direction = meshCenter.clone().sub(center).normalize();
      mesh.position.copy(mesh.userData.originalPosition);
      mesh.position.add(direction.multiplyScalar(1.5));
    });
  }, [viewMode, box, clonedScene]);

  return (
    <group>
      <Center>
        <primitive object={clonedScene} />
      </Center>
      {showDimensions && box && (
        <group>
          <DimensionMarker
            start={new THREE.Vector3(box.min.x, box.min.y, box.min.z)}
            end={new THREE.Vector3(box.max.x, box.min.y, box.min.z)}
            label={`${((box.max.x - box.min.x) * 1000).toFixed(1)} mm`}
            axis="x"
          />
          <DimensionMarker
            start={new THREE.Vector3(box.min.x, box.min.y, box.min.z)}
            end={new THREE.Vector3(box.min.x, box.max.y, box.min.z)}
            label={`${((box.max.y - box.min.y) * 1000).toFixed(1)} mm`}
            axis="y"
          />
          <DimensionMarker
            start={new THREE.Vector3(box.min.x, box.min.y, box.min.z)}
            end={new THREE.Vector3(box.min.x, box.min.y, box.max.z)}
            label={`${((box.max.z - box.min.z) * 1000).toFixed(1)} mm`}
            axis="z"
          />
        </group>
      )}
    </group>
  );
}
