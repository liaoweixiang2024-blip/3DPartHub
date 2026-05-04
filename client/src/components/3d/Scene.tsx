import { Grid } from '@react-three/drei';
import { get3DMaterialConfig, type ViewerSettingsOverride } from '../../lib/publicSettings';

interface SceneProps {
  showGrid: boolean;
  showAxis?: boolean;
  viewerSettings?: ViewerSettingsOverride;
}

export default function Scene({ showGrid, viewerSettings }: SceneProps) {
  const config = get3DMaterialConfig(viewerSettings).viewer;

  return (
    <>
      <ambientLight intensity={config.ambientIntensity} />
      <directionalLight position={[10, 10, 5]} intensity={config.mainLightIntensity} />
      <directionalLight position={[-8, 6, -8]} intensity={config.fillLightIntensity} color="#b0c4de" />
      <directionalLight position={[0, -5, 10]} intensity={0.3} color="#e0e8f0" />
      <pointLight position={[0, 15, 0]} intensity={0.4} />
      <hemisphereLight args={['#b1e1ff', '#b97a20', config.hemisphereIntensity]} />

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
    </>
  );
}
