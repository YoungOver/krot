import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useTunnel } from './tunnelStore'

// Mine shaft: timber frames rush toward the camera; a request fired from the
// terminal travels through the shaft as a glowing packet.

const FRAMES = 44
const GAP = 3.2
const DEPTH = FRAMES * GAP

function Frames() {
  const posts = useRef<THREE.InstancedMesh>(null!)
  const beams = useRef<THREE.InstancedMesh>(null!)
  const lamps = useRef<THREE.InstancedMesh>(null!)
  const jitter = useMemo(() => Array.from({ length: FRAMES }, () => [(Math.random() - 0.5) * 0.14, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.06]), [])
  const m = useMemo(() => new THREE.Object3D(), [])
  const offset = useRef(0)

  useFrame((_, dt) => {
    offset.current = (offset.current + dt * 6 * useTunnel.getState().speed) % GAP
    for (let i = 0; i < FRAMES; i++) {
      const z = -i * GAP + offset.current
      const [tilt, sway, roll] = jitter[i]
      for (const side of [-1, 1]) {
        m.position.set(side * (2.25 + sway * 0.3), -0.25, z)
        m.rotation.set(0, 0, side * 0.07 + roll)
        m.scale.set(0.26, 3.9, 0.26)
        m.updateMatrix()
        posts.current.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), m.matrix)
      }
      m.position.set(sway * 0.2, 1.7, z)
      m.rotation.set(0, 0, tilt)
      m.scale.set(5.1, 0.3, 0.32)
      m.updateMatrix()
      beams.current.setMatrixAt(i, m.matrix)
      // every fourth frame carries a lamp hanging from the beam
      m.position.set(0.4 + sway, 1.3, z)
      m.rotation.set(0, 0, 0)
      m.scale.setScalar(i % 4 === 0 && i > 1 ? 0.07 : 0)
      m.updateMatrix()
      lamps.current.setMatrixAt(i, m.matrix)
    }
    posts.current.instanceMatrix.needsUpdate = true
    beams.current.instanceMatrix.needsUpdate = true
    lamps.current.instanceMatrix.needsUpdate = true
  })

  return (
    <>
      <instancedMesh ref={posts} args={[undefined, undefined, FRAMES * 2]}>
        <boxGeometry />
        <meshStandardMaterial color="#5a3b24" roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={beams} args={[undefined, undefined, FRAMES]}>
        <boxGeometry />
        <meshStandardMaterial color="#6b472b" roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={lamps} args={[undefined, undefined, FRAMES]}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshBasicMaterial color="#ffcf8a" toneMapped={false} />
      </instancedMesh>
    </>
  )
}

function Walls() {
  // Irregular rock: a displaced open cylinder seen from inside.
  const geo = useMemo(() => {
    const g = new THREE.CylinderGeometry(3.4, 3.4, DEPTH + 10, 28, 80, true)
    const p = g.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
      const n = Math.sin(y * 0.9 + x * 2.1) * 0.22 + Math.sin(y * 2.7 + z * 3.3) * 0.12 + (Math.random() - 0.5) * 0.12
      const k = 1 + n / 3.4
      p.setXYZ(i, x * k, y, z * k)
    }
    g.computeVertexNormals()
    g.rotateX(Math.PI / 2)
    g.translate(0, 0.3, -DEPTH / 2 + 4)
    return g
  }, [])
  return (
    <mesh geometry={geo}>
      <meshStandardMaterial color="#2a1c14" roughness={1} side={THREE.BackSide} flatShading />
    </mesh>
  )
}

function Packets() {
  const packets = useTunnel((s) => s.packets)
  const group = useRef<THREE.Group>(null!)
  useFrame(() => {
    const t = performance.now()
    group.current.children.forEach((c, i) => {
      const p = packets[i]
      if (!p) return
      const age = Math.max(0, (t - p.born) / 1600)
      const z = -DEPTH + age * (DEPTH + 6)
      c.position.set(Math.cos(p.lane) * 0.6, Math.sin(p.lane) * 0.35 + 0.1, z)
      c.visible = age > 0 && age < 1
      c.scale.setScalar(0.12 + age * 0.12)
    })
  })
  return (
    <group ref={group}>
      {packets.map((p) => (
        <mesh key={p.id} visible={false}>
          <sphereGeometry args={[1, 16, 16]} />
          <meshBasicMaterial color="#3ee6c1" toneMapped={false} />
          <pointLight color="#3ee6c1" intensity={6} distance={7} />
        </mesh>
      ))}
    </group>
  )
}

function Rig() {
  useFrame(({ camera, pointer }) => {
    camera.position.x += (pointer.x * 0.5 - camera.position.x) * 0.04
    camera.position.y += (pointer.y * 0.3 + 0.2 - camera.position.y) * 0.04
    camera.lookAt(0, 0.1, -30)
  })
  return null
}

export default function Tunnel3D() {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 0.2, 5], fov: 62, near: 0.1, far: 160 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ scene }) => {
        scene.background = new THREE.Color('#120d0a')
        scene.fog = new THREE.FogExp2('#120d0a', 0.035)
      }}
    >
      <ambientLight intensity={0.45} color="#ffddb0" />
      <hemisphereLight args={["#ffcf8a", "#120d0a", 0.35]} />
      <pointLight position={[0.6, 1.2, 2]} intensity={14} distance={16} color="#ffb347" />
      <pointLight position={[0, 0.5, -60]} intensity={120} distance={90} color="#ff9a3d" />
      <pointLight position={[0, 0.8, -22]} intensity={30} distance={30} color="#ffb347" />
      <mesh position={[0, 0.3, -DEPTH + 6]}>
        <circleGeometry args={[3.2, 32]} />
        <meshBasicMaterial color="#ff9a3d" transparent opacity={0.35} toneMapped={false} />
      </mesh>
      <Walls />
      <Frames />
      <Packets />
      <Rig />
    </Canvas>
  )
}
