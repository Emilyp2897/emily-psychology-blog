import { useEffect } from 'react';
import { tsParticles } from 'tsparticles-engine';
import { loadStarsPreset } from 'tsparticles-preset-stars';

export default function ParticlesBG() {
  useEffect(() => {
    loadStarsPreset(tsParticles).then(() => {
      tsParticles.load('tsparticles', {
        preset: 'stars',
        background: {
          color: '#181818',
        },
        fullScreen: { enable: true, zIndex: -1 },
        particles: {
          color: { value: '#fff' },
          number: { value: 80 },
        },
      });
    });
  }, []);
  return <div id="tsparticles" style={{ position: 'fixed', inset: 0, zIndex: -1 }}></div>;
}
