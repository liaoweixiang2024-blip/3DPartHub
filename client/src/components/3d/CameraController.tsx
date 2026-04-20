import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { CameraPreset } from "./ModelViewer";

interface CamPreset {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

const presets: Record<CameraPreset, CamPreset> = {
  front: { position: new THREE.Vector3(0, 0, 5), target: new THREE.Vector3(0, 0, 0) },
  side: { position: new THREE.Vector3(5, 0, 0), target: new THREE.Vector3(0, 0, 0) },
  iso: { position: new THREE.Vector3(5, 3, 5), target: new THREE.Vector3(0, 0, 0) },
  top: { position: new THREE.Vector3(0, 5, 0.01), target: new THREE.Vector3(0, 0, 0) },
};

export default function CameraController({ preset }: { preset: CameraPreset }) {
  const { camera, gl } = useThree();
  const controlsRef = useRef<any>(null);

  function applyPreset(p: CamPreset) {
    camera.position.copy(p.position);
    camera.lookAt(p.target);
    // Sync OrbitControls target
    if (controlsRef.current) {
      controlsRef.current.target.copy(p.target);
      controlsRef.current.update();
    }
  }

  function buildPresets(center: THREE.Vector3, dist: number) {
    presets.front = {
      position: new THREE.Vector3(center.x, center.y, center.z + dist),
      target: center.clone(),
    };
    presets.side = {
      position: new THREE.Vector3(center.x + dist, center.y, center.z),
      target: center.clone(),
    };
    presets.iso = {
      position: new THREE.Vector3(
        center.x + dist * 0.58,
        center.y + dist * 0.38,
        center.z + dist * 0.58
      ),
      target: center.clone(),
    };
    presets.top = {
      position: new THREE.Vector3(center.x, center.y + dist, center.z + 0.01),
      target: center.clone(),
    };
  }

  // Find OrbitControls instance from DOM
  useEffect(() => {
    const findControls = () => {
      // @ts-ignore — internal fiber
      const fiber = gl.domElement.__reactFiber$;
      if (!fiber) return;
      // Walk up to find OrbitControls ref
      let node = fiber;
      while (node) {
        const controls = node.memoizedProps?.ref?.current;
        if (controls && controls.target) {
          controlsRef.current = controls;
          return;
        }
        node = node.return;
      }
    };
    // Delay to ensure controls are mounted
    setTimeout(findControls, 100);
  }, [gl]);

  // Model loaded — calculate proper camera distance
  useEffect(() => {
    const handler = (e: Event) => {
      const { center: c, size } = (e as CustomEvent).detail;
      const center = new THREE.Vector3(c.x || 0, c.y || 0, c.z || 0);

      const fov = ((camera as THREE.PerspectiveCamera).fov || 45) * (Math.PI / 180);
      const fitDistance = size / (2 * Math.tan(fov / 2)) * 1.4;

      // Update camera far plane to handle large models
      (camera as THREE.PerspectiveCamera).far = Math.max(size * 100, 100000);
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();

      buildPresets(center, fitDistance);
      applyPreset(presets[preset]);
    };

    window.addEventListener("model-loaded", handler);
    return () => window.removeEventListener("model-loaded", handler);
  }, [camera, preset]);

  // User switches preset
  useEffect(() => {
    applyPreset(presets[preset]);
  }, [preset, camera]);

  return null;
}
