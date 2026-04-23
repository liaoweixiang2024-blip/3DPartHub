import { Grid, GizmoHelper, GizmoViewport } from "@react-three/drei";

interface SceneProps {
  showGrid: boolean;
  showAxis?: boolean;
}

export default function Scene({ showGrid, showAxis = true }: SceneProps) {
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 10, 5]} intensity={1.4} />
      <directionalLight position={[-8, 6, -8]} intensity={0.6} color="#b0c4de" />
      <directionalLight position={[0, -5, 10]} intensity={0.3} color="#e0e8f0" />
      <pointLight position={[0, 15, 0]} intensity={0.4} />
      <hemisphereLight args={["#b1e1ff", "#b97a20", 0.3]} />

      {showGrid && (
        <Grid
          args={[100, 100]}
          cellSize={2}
          cellThickness={0.5}
          cellColor="#3a4a5a"
          sectionSize={10}
          sectionThickness={1}
          sectionColor="#4a5a6a"
          fadeDistance={80}
          fadeStrength={1}
          followCamera={false}
          position={[0, -0.01, 0]}
        />
      )}

      {showAxis && (
        <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
          <GizmoViewport labelColor="white" axisHeadScale={0.8} />
        </GizmoHelper>
      )}
    </>
  );
}
