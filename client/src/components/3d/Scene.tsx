import { Grid, GizmoHelper, GizmoViewport } from "@react-three/drei";

interface SceneProps {
  showGrid: boolean;
  showAxis?: boolean;
}

export default function Scene({ showGrid, showAxis = true }: SceneProps) {
  return (
    <>
      <ambientLight intensity={1.0} />
      <directionalLight position={[10, 15, 10]} intensity={1.8} />
      <directionalLight position={[-10, 10, -5]} intensity={0.8} color="#d0d8e8" />
      <directionalLight position={[0, -5, 10]} intensity={0.5} color="#e8eef5" />
      <pointLight position={[0, 20, 0]} intensity={0.6} />
      <hemisphereLight args={["#c8e0ff", "#d4a050", 0.5]} />

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
