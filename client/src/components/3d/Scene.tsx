import { useEffect, useState } from 'react';
import { Grid } from '@react-three/drei';
import { get3DMaterialConfig, type ViewerSettingsOverride } from '../../lib/publicSettings';
import { MODEL_BOUNDS_EVENT, type ModelBoundsDetail } from './viewerEvents';

interface SceneProps {
  showGrid: boolean;
  showAxis?: boolean;
  viewerSettings?: ViewerSettingsOverride;
}

export default function Scene({ showGrid, viewerSettings }: SceneProps) {
  const config = get3DMaterialConfig(viewerSettings).viewer;
  const [gridY, setGridY] = useState(-0.01);

  useEffect(() => {
    if (!showGrid) return;
    const handler = (e: CustomEvent<ModelBoundsDetail>) => {
      const { center, size } = e.detail;
      setGridY(center.y - size.y / 2);
    };
    window.addEventListener(MODEL_BOUNDS_EVENT, handler as EventListener);
    return () => window.removeEventListener(MODEL_BOUNDS_EVENT, handler as EventListener);
  }, [showGrid]);

  return (
    <>
      <ambientLight intensity={config.ambientIntensity} />
      <directionalLight position={[10, 10, 5]} intensity={config.mainLightIntensity} />
      <directionalLight position={[-10, 8, -5]} intensity={config.fillLightIntensity} color="#c8d8e8" />
      <directionalLight position={[0, -5, 10]} intensity={0.5} color="#e0e8f0" />
      <pointLight position={[0, 15, 0]} intensity={0.6} />
      <hemisphereLight args={['#ffffff', '#e8dcc8', config.hemisphereIntensity]} />

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
          position={[0, gridY, 0]}
        />
      )}
    </>
  );
}
