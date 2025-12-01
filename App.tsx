/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { generatePirateEvent } from './services/gemini';
import { SpeakerWaveIcon, SpeakerXMarkIcon } from '@heroicons/react/24/solid';

// --- Types ---
interface Vector { x: number; y: number; }
interface Entity { id: number; x: number; y: number; radius: number; rotation: number; active: boolean; }
interface Ship extends Entity { 
  velocity: Vector; 
  angularVelocity: number; // Physics for turning
  speed: number; 
  health: number; 
  maxHealth: number; 
  cooldown: number; 
  type: 'player' | 'pirate' | 'elite';
  wobbleOffset: number;
}
interface Particle extends Entity { velocity: Vector; life: number; maxLife: number; color: string; size: number; type: 'smoke' | 'fire' | 'water' | 'spark' | 'glint' | 'muzzle'; }
interface Projectile extends Entity { velocity: Vector; owner: 'player' | 'enemy'; damage: number; }
interface Island extends Entity { name: string; delivered: boolean; color: string; variant: number; }

// --- Game Constants ---
const WORLD_SIZE = 4000;
const SHIP_THRUST = 0.15; // Reduced from 0.35 for better control
const TURN_TORQUE = 0.0015; // Reduced from 0.0025 for heavier feel
const MAX_ANGULAR_VELOCITY = 0.025; // Reduced from 0.04
const ANGULAR_DRAG = 0.96; // Resistance to spinning
const FORWARD_DRAG = 0.99; // Water resistance moving forward
const SIDEWAYS_DRAG = 0.92; // "Keel" resistance (prevents sliding sideways)
const CANNON_SPEED = 9; // Reduced from 16
const CANNON_COOLDOWN = 50; // Slower fire rate for broadsides
const ENEMY_COOLDOWN = 90;

// --- Helpers ---
const lerp = (start: number, end: number, t: number) => start * (1 - t) + end * t;
const randomRange = (min: number, max: number) => Math.random() * (max - min) + min;

const App: React.FC = () => {
  // --- State ---
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadingMessage, setLoadingMessage] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  // --- Refs for Game Loop ---
  const gameState = useRef({
    player: { 
      id: 0, x: WORLD_SIZE / 2, y: WORLD_SIZE / 2, radius: 30, rotation: 0, 
      active: true, velocity: { x: 0, y: 0 }, angularVelocity: 0, speed: 0, health: 100, maxHealth: 100, cooldown: 0,
      type: 'player', wobbleOffset: 0
    } as Ship,
    keys: { w: false, a: false, s: false, d: false, space: false },
    projectiles: [] as Projectile[],
    particles: [] as Particle[],
    enemies: [] as Ship[],
    islands: [] as Island[],
    camera: { x: 0, y: 0, shake: 0 },
    lastTime: 0,
    time: 0,
    frameCount: 0
  });

  // --- Initialization ---
  const initGame = useCallback(() => {
    const s = gameState.current;
    s.player.x = WORLD_SIZE / 2;
    s.player.y = WORLD_SIZE / 2;
    s.player.velocity = { x: 0, y: 0 };
    s.player.angularVelocity = 0;
    s.player.health = 100;
    s.player.active = true;
    s.player.rotation = -Math.PI / 2;
    s.projectiles = [];
    s.particles = [];
    s.enemies = [];
    s.islands = [];
    s.camera.shake = 0;
    setScore(0);
    setGameOver(false);
    setMessage("Welcome Captain! Use A/D to steer and W to hoist sails. SPACE fires Broadsides (Left & Right). Deliver presents to the islands!");

    // Generate Islands
    for (let i = 0; i < 12; i++) {
      let x, y, dist;
      do {
        x = randomRange(200, WORLD_SIZE - 200);
        y = randomRange(200, WORLD_SIZE - 200);
        dist = Math.hypot(x - WORLD_SIZE/2, y - WORLD_SIZE/2);
      } while(dist < 500); // Keep islands away from spawn

      s.islands.push({
        id: i,
        x, y,
        radius: randomRange(70, 100),
        rotation: randomRange(0, Math.PI * 2),
        active: true,
        name: `Isle ${i + 1}`,
        delivered: false,
        color: `hsl(${randomRange(90, 140)}, 60%, 45%)`,
        variant: Math.floor(Math.random() * 3)
      });
    }

    // Spawn initial enemies
    for(let i=0; i<3; i++) spawnEnemy();
    
    // Ambient Ocean particles
    for(let i=0; i<80; i++) {
        s.particles.push({
            id: Math.random(),
            x: Math.random() * WORLD_SIZE,
            y: Math.random() * WORLD_SIZE,
            radius: 0, rotation: 0, active: true,
            velocity: {x: 0, y: 0},
            life: 1, maxLife: 1,
            color: 'white', size: Math.random() * 2 + 1,
            type: 'glint'
        });
    }

    s.lastTime = performance.now();
  }, []);

  const spawnEnemy = () => {
    const s = gameState.current;
    if (s.enemies.length > 8) return;
    
    let ex, ey, dist;
    do {
        ex = Math.random() * WORLD_SIZE;
        ey = Math.random() * WORLD_SIZE;
        dist = Math.hypot(ex - s.player.x, ey - s.player.y);
    } while (dist < 1000); // Spawn far away

    s.enemies.push({
      id: Math.random(),
      x: ex, 
      y: ey,
      radius: 30,
      rotation: Math.random() * Math.PI * 2,
      active: true,
      velocity: { x: 0, y: 0 },
      angularVelocity: 0,
      speed: 0,
      health: 40,
      maxHealth: 40,
      cooldown: 0,
      type: 'pirate',
      wobbleOffset: Math.random() * 100
    });
  };

  // --- Input Handling ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'w' || k === 'arrowup') gameState.current.keys.w = true;
      if (k === 'a' || k === 'arrowleft') gameState.current.keys.a = true;
      if (k === 's' || k === 'arrowdown') gameState.current.keys.s = true;
      if (k === 'd' || k === 'arrowright') gameState.current.keys.d = true;
      if (k === ' ') gameState.current.keys.space = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'w' || k === 'arrowup') gameState.current.keys.w = false;
      if (k === 'a' || k === 'arrowleft') gameState.current.keys.a = false;
      if (k === 's' || k === 'arrowdown') gameState.current.keys.s = false;
      if (k === 'd' || k === 'arrowright') gameState.current.keys.d = false;
      if (k === ' ') gameState.current.keys.space = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // --- Physics Helper ---
  const applyShipPhysics = (ship: Ship, thrust: boolean, turnLeft: boolean, turnRight: boolean, dt: number) => {
     // 1. Angular Physics (Turning)
     // Apply torque
     if (turnLeft) ship.angularVelocity -= TURN_TORQUE * dt;
     if (turnRight) ship.angularVelocity += TURN_TORQUE * dt;
     
     // Angular Drag
     ship.angularVelocity *= Math.pow(ANGULAR_DRAG, dt);
     // Clamp Max Turn
     ship.angularVelocity = Math.max(-MAX_ANGULAR_VELOCITY, Math.min(MAX_ANGULAR_VELOCITY, ship.angularVelocity));
     
     // Apply Rotation
     ship.rotation += ship.angularVelocity * dt;

     // 2. Linear Physics (Movement)
     // Calculate Forward Vector based on rotation
     // Note: Standard Math.cos/sin assumes 0 is +X (Right).
     // Our ship visual has Bow at -Y (Up). 
     // We compensate in the Draw function by rotating +90deg.
     // So here, Physics Rotation 0 = Right. Visual draws Right.
     
     if (thrust) {
         ship.velocity.x += Math.cos(ship.rotation) * SHIP_THRUST * dt;
         ship.velocity.y += Math.sin(ship.rotation) * SHIP_THRUST * dt;
     }

     // 3. Keel Physics (Drift/Drag)
     // Decompose velocity into Forward and Sideways components relative to the ship
     const forwardX = Math.cos(ship.rotation);
     const forwardY = Math.sin(ship.rotation);
     const rightX = -Math.sin(ship.rotation); // Perpendicular vector
     const rightY = Math.cos(ship.rotation);

     // Dot product to get magnitude in each direction
     const dotForward = ship.velocity.x * forwardX + ship.velocity.y * forwardY;
     const dotRight = ship.velocity.x * rightX + ship.velocity.y * rightY;

     // Apply different drag coefficients
     // Ships glide well forward, but resist moving sideways strongly (Keel)
     const newForwardMag = dotForward * Math.pow(FORWARD_DRAG, dt);
     const newRightMag = dotRight * Math.pow(SIDEWAYS_DRAG, dt);

     // Recompose velocity
     ship.velocity.x = newForwardMag * forwardX + newRightMag * rightX;
     ship.velocity.y = newForwardMag * forwardY + newRightMag * rightY;

     // Update Position
     ship.x += ship.velocity.x * dt;
     ship.y += ship.velocity.y * dt;

     // Wake Particles
     const speed = Math.hypot(ship.velocity.x, ship.velocity.y);
     if (speed > 1 && Math.random() > 0.8) {
         createWake(ship);
     }
  };

  const createWake = (ship: Ship) => {
    const s = gameState.current;
    const angle = ship.rotation + Math.PI; // Behind ship
    // Left wake
    s.particles.push({
        id: Math.random(),
        x: ship.x + Math.cos(angle + 0.5) * 20, 
        y: ship.y + Math.sin(angle + 0.5) * 20,
        radius: 0, rotation: 0, active: true,
        velocity: { x: 0, y: 0 },
        life: 0.8, maxLife: 0.8,
        color: 'rgba(255, 255, 255, 0.3)',
        size: randomRange(3, 8), type: 'water'
    });
    // Right wake
    s.particles.push({
      id: Math.random(),
      x: ship.x + Math.cos(angle - 0.5) * 20, 
      y: ship.y + Math.sin(angle - 0.5) * 20,
      radius: 0, rotation: 0, active: true,
      velocity: { x: 0, y: 0 },
      life: 0.8, maxLife: 0.8,
      color: 'rgba(255, 255, 255, 0.3)',
      size: randomRange(3, 8), type: 'water'
  });
};

  // --- Game Loop ---
  useEffect(() => {
    if (!gameStarted) return;
    
    let animationFrameId: number;
    const ctx = canvasRef.current?.getContext('2d');
    
    const update = (time: number) => {
      const s = gameState.current;
      const dt = Math.min((time - s.lastTime) / 16.67, 2); // Delta time normalized to 60fps, capped at 2x
      s.lastTime = time;
      s.time += 0.01 * dt;

      const p = s.player;

      if (!p.active) {
          if (!gameOver) setGameOver(true);
      }

      // --- Screen Shake Decay ---
      if (s.camera.shake > 0) s.camera.shake *= 0.9;
      if (s.camera.shake < 0.5) s.camera.shake = 0;

      // --- Player Logic ---
      if (p.active && !message) {
        // Physics
        applyShipPhysics(p, s.keys.w, s.keys.a, s.keys.d, dt);

        // Boundaries
        p.x = Math.max(0, Math.min(WORLD_SIZE, p.x));
        p.y = Math.max(0, Math.min(WORLD_SIZE, p.y));

        // Shooting
        if (p.cooldown > 0) p.cooldown -= 1 * dt;
        if (s.keys.space && p.cooldown <= 0) {
           fireBroadside(p, 'player');
           p.cooldown = CANNON_COOLDOWN;
        }
      }

      // --- Enemy Logic ---
      s.enemies.forEach(enemy => {
         if (!enemy.active || message) return;
         
         const dx = p.x - enemy.x;
         const dy = p.y - enemy.y;
         const dist = Math.hypot(dx, dy);
         const angleToPlayer = Math.atan2(dy, dx);

         // AI Steering: Chaser
         // Try to point bow at player
         let angleDiff = angleToPlayer - enemy.rotation;
         while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
         while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
         
         const turnLeft = angleDiff < -0.1;
         const turnRight = angleDiff > 0.1;
         // Thrust if facing roughly towards player or far away
         const thrust = dist > 250 && Math.abs(angleDiff) < 1.0;

         applyShipPhysics(enemy, thrust, turnLeft, turnRight, dt);

         // Shoot logic (Bow Chasers)
         if (enemy.cooldown > 0) enemy.cooldown -= 1 * dt;
         // Fire if facing player and close enough
         if (dist < 500 && enemy.cooldown <= 0 && Math.abs(angleDiff) < 0.3) {
            fireChasers(enemy, 'enemy');
            enemy.cooldown = ENEMY_COOLDOWN; 
         }
      });

      // --- Projectiles ---
      for (let i = s.projectiles.length - 1; i >= 0; i--) {
        const proj = s.projectiles[i];
        if (message) break; 
        proj.x += proj.velocity.x * dt;
        proj.y += proj.velocity.y * dt;
        
        // Smoke trail
        if (Math.random() > 0.7) {
             s.particles.push({
                id: Math.random(),
                x: proj.x, y: proj.y,
                radius: 2, rotation: 0, active: true,
                velocity: { x: 0, y: 0 },
                life: 0.4, maxLife: 0.4,
                color: 'rgba(220,220,220,0.2)',
                size: randomRange(2,3), type: 'smoke'
            });
        }

        // Remove out of bounds
        if (proj.x < 0 || proj.x > WORLD_SIZE || proj.y < 0 || proj.y > WORLD_SIZE) {
            s.projectiles.splice(i, 1);
            continue;
        }

        // Collision: Projectile vs Player
        if (proj.owner === 'enemy' && p.active) {
            if (checkCollision(proj, p)) {
                p.health -= 8;
                s.camera.shake = 8;
                createExplosion(p.x, p.y, 'orange', 15);
                s.projectiles.splice(i, 1);
                if (p.health <= 0) {
                    p.active = false;
                    createExplosion(p.x, p.y, 'red', 60);
                }
                continue;
            }
        }

        // Collision: Projectile vs Enemy
        if (proj.owner === 'player') {
            let hit = false;
            for (const enemy of s.enemies) {
                if (!enemy.active) continue;
                if (checkCollision(proj, enemy)) {
                    enemy.health -= 15;
                    createExplosion(enemy.x, enemy.y, 'orange', 8);
                    hit = true;
                    if (enemy.health <= 0) {
                        enemy.active = false;
                        createExplosion(enemy.x, enemy.y, 'red', 40);
                        s.camera.shake = 5;
                        setScore(prev => prev + 150);
                        setTimeout(() => spawnEnemy(), 2000); // Respawn delayed
                        if (Math.random() > 0.6) setTimeout(() => spawnEnemy(), 5000); 
                    }
                    break;
                }
            }
            if (hit) {
                s.projectiles.splice(i, 1);
                continue;
            }
        }
      }

      // --- Island Delivery ---
      if (p.active && !message && !loadingMessage) {
          for (const island of s.islands) {
              if (island.delivered) continue;
              const dist = Math.hypot(p.x - island.x, p.y - island.y);
              if (dist < island.radius + p.radius) {
                  deliverPresent(island);
              }
          }
      }

      // --- Particles ---
      for (let i = s.particles.length - 1; i >= 0; i--) {
        const part = s.particles[i];
        if (part.type === 'glint') {
            // Ambient glints
            part.x += Math.sin(s.time + part.id) * 0.2;
            if (Math.random() > 0.99) part.x = randomRange(0, WORLD_SIZE);
            if (Math.random() > 0.99) part.y = randomRange(0, WORLD_SIZE);
            continue;
        }

        part.x += part.velocity.x * dt;
        part.y += part.velocity.y * dt;
        part.life -= 0.02 * dt;
        part.size *= 0.95; // Shrink
        if (part.life <= 0) s.particles.splice(i, 1);
      }

      s.frameCount++;
    };

    const draw = () => {
      if (!ctx || !canvasRef.current) return;
      const s = gameState.current;
      const width = canvasRef.current.width;
      const height = canvasRef.current.height;

      // Camera Smooth Follow with LookAhead
      // Look ahead based on velocity to see where we are going
      const lookAheadX = s.player.velocity.x * 25;
      const lookAheadY = s.player.velocity.y * 25;
      
      const targetCamX = (s.player.x + lookAheadX) - width / 2;
      const targetCamY = (s.player.y + lookAheadY) - height / 2;
      
      s.camera.x = lerp(s.camera.x, targetCamX, 0.08);
      s.camera.y = lerp(s.camera.y, targetCamY, 0.08);

      // Clamp Camera
      s.camera.x = Math.max(0, Math.min(WORLD_SIZE - width, s.camera.x));
      s.camera.y = Math.max(0, Math.min(WORLD_SIZE - height, s.camera.y));

      // Apply Shake
      const shakeX = (Math.random() - 0.5) * s.camera.shake;
      const shakeY = (Math.random() - 0.5) * s.camera.shake;

      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(-s.camera.x + shakeX, -s.camera.y + shakeY);

      // --- 1. OCEAN ---
      const gradient = ctx.createLinearGradient(s.camera.x, s.camera.y, s.camera.x + width, s.camera.y + height);
      gradient.addColorStop(0, '#0f172a');
      gradient.addColorStop(1, '#1e3a8a');
      ctx.fillStyle = gradient;
      ctx.fillRect(s.camera.x, s.camera.y, width, height);

      // Grid
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.lineWidth = 2;
      const gridSize = 150;
      const startX = Math.floor(s.camera.x / gridSize) * gridSize;
      const startY = Math.floor(s.camera.y / gridSize) * gridSize;
      ctx.beginPath();
      for (let x = startX; x < s.camera.x + width + gridSize; x += gridSize) {
          ctx.moveTo(x, s.camera.y);
          ctx.lineTo(x, s.camera.y + height);
      }
      for (let y = startY; y < s.camera.y + height + gridSize; y += gridSize) {
          ctx.moveTo(s.camera.x, y);
          ctx.lineTo(s.camera.x + width, y);
      }
      ctx.stroke();

      // Glints
      s.particles.filter(p => p.type === 'glint').forEach(p => {
         if (p.x > s.camera.x && p.x < s.camera.x + width && p.y > s.camera.y && p.y < s.camera.y + height) {
             ctx.globalAlpha = 0.3 + Math.sin(s.time * 5 + p.id * 10) * 0.2;
             ctx.fillStyle = 'white';
             ctx.beginPath();
             ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
             ctx.fill();
             ctx.globalAlpha = 1;
         }
      });

      // --- 2. ISLANDS ---
      s.islands.forEach(island => {
          if (island.x + island.radius < s.camera.x || island.x - island.radius > s.camera.x + width ||
              island.y + island.radius < s.camera.y || island.y - island.radius > s.camera.y + height) return;

          ctx.save();
          ctx.translate(island.x, island.y);
          
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.beginPath(); ctx.arc(5, 5, island.radius, 0, Math.PI * 2); ctx.fill();

          ctx.fillStyle = '#fde047';
          ctx.beginPath(); ctx.arc(0, 0, island.radius, 0, Math.PI * 2); ctx.fill();

          ctx.fillStyle = island.delivered ? '#4ade80' : island.color;
          ctx.beginPath(); ctx.arc(0, 0, island.radius * 0.75, 0, Math.PI * 2); ctx.fill();

          const numTrees = 5;
          for(let i=0; i<numTrees; i++) {
              const angle = (i / numTrees) * Math.PI * 2 + island.id;
              const dist = island.radius * 0.5;
              const tx = Math.cos(angle) * dist;
              const ty = Math.sin(angle) * dist;
              ctx.fillStyle = '#713f12';
              ctx.beginPath(); ctx.arc(tx, ty, 4, 0, Math.PI * 2); ctx.fill();
              ctx.fillStyle = '#14532d';
              drawStar(ctx, tx, ty, 5, 12, 5);
          }

          ctx.fillStyle = 'white';
          ctx.font = 'bold 14px Inter';
          ctx.textAlign = 'center';
          ctx.shadowColor = 'black';
          ctx.shadowBlur = 4;
          ctx.fillText(island.name, 0, island.radius + 20);
          ctx.shadowBlur = 0;
          if (island.delivered) {
              ctx.font = '30px Inter';
              ctx.fillText('🎁', 0, 0);
          }
          ctx.restore();
      });

      // --- 3. PARTICLES (Low) ---
      s.particles.forEach(p => {
          if (p.type === 'water') {
              ctx.globalAlpha = p.life;
              ctx.fillStyle = p.color;
              ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
              ctx.globalAlpha = 1;
          }
      });

      // --- 4. SHIPS ---
      s.enemies.forEach(enemy => {
          if (enemy.active && isInView(enemy, s.camera, width, height)) 
            drawRealisticShip(ctx, enemy, 'pirate', s.time);
      });

      if (s.player.active) {
          drawRealisticShip(ctx, s.player, 'player', s.time);
          // Health
          ctx.fillStyle = '#111';
          ctx.fillRect(s.player.x - 20, s.player.y - 50, 40, 6);
          ctx.fillStyle = s.player.health > 30 ? '#22c55e' : '#ef4444';
          ctx.fillRect(s.player.x - 19, s.player.y - 49, 38 * (s.player.health / s.player.maxHealth), 4);
      }

      // --- 5. PROJECTILES ---
      s.projectiles.forEach(p => {
          ctx.shadowColor = 'black';
          ctx.shadowBlur = 5;
          ctx.fillStyle = '#09090b';
          ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#525252';
          ctx.beginPath(); ctx.arc(p.x - 1.5, p.y - 1.5, 1.5, 0, Math.PI * 2); ctx.fill();
      });

      // --- 6. PARTICLES (High) ---
      s.particles.forEach(p => {
          if (p.type !== 'water' && p.type !== 'glint') {
              ctx.globalAlpha = p.life;
              ctx.fillStyle = p.color;
              ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
              ctx.globalAlpha = 1;
          }
      });

      ctx.restore();

      animationFrameId = requestAnimationFrame((t) => {
          update(t);
          draw();
      });
    };

    animationFrameId = requestAnimationFrame((t) => {
        gameState.current.lastTime = t;
        draw();
    });

    return () => cancelAnimationFrame(animationFrameId);
  }, [gameStarted, gameOver, message, loadingMessage]);

  // --- Helpers ---
  const isInView = (e: Entity, camera: {x: number, y: number}, w: number, h: number) => {
      return e.x + e.radius > camera.x && e.x - e.radius < camera.x + w &&
             e.y + e.radius > camera.y && e.y - e.radius < camera.y + h;
  };

  const checkCollision = (c1: Entity, c2: Entity) => {
      const dist = Math.hypot(c1.x - c2.x, c1.y - c2.y);
      return dist < c1.radius + c2.radius - 5; 
  };

  const createExplosion = (x: number, y: number, type: 'orange' | 'red', count = 10) => {
      const s = gameState.current;
      for (let i = 0; i < count; i++) {
          s.particles.push({
              id: Math.random(),
              x, y,
              radius: 0, rotation: 0, active: true,
              velocity: { x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8 },
              life: randomRange(0.5, 1.0), maxLife: 1,
              color: type === 'red' ? '#ef4444' : '#f97316',
              size: randomRange(3, 6),
              type: 'fire'
          });
      }
      for (let i = 0; i < count / 2; i++) {
        s.particles.push({
            id: Math.random(),
            x, y,
            radius: 0, rotation: 0, active: true,
            velocity: { x: (Math.random() - 0.5) * 4, y: (Math.random() - 0.5) * 4 },
            life: randomRange(1.0, 2.0), maxLife: 2,
            color: 'rgba(100,100,100,0.5)',
            size: randomRange(5, 12),
            type: 'smoke'
        });
      }
  };

  // --- Shooting Mechanics ---
  
  // Player: Fires from Left and Right sides (Broadsides)
  const fireBroadside = (ship: Ship, owner: 'player' | 'enemy') => {
      // Recoil
      ship.velocity.x -= Math.cos(ship.rotation) * 0.5;
      ship.velocity.y -= Math.sin(ship.rotation) * 0.5;
      gameState.current.camera.shake = 5;

      // Port Side (-90 deg)
      fireCannons(ship, owner, -Math.PI/2);
      // Starboard Side (+90 deg)
      fireCannons(ship, owner, Math.PI/2);
  };

  // Enemy: Fires from Front (Chasers)
  const fireChasers = (ship: Ship, owner: 'player' | 'enemy') => {
      const s = gameState.current;
      // Two front facing guns
      const offsets = [-5, 5];
      
      const fwdX = Math.cos(ship.rotation);
      const fwdY = Math.sin(ship.rotation);
      const rightX = -Math.sin(ship.rotation);
      const rightY = Math.cos(ship.rotation);

      offsets.forEach(offX => {
           // Bow is forward 32 units.
           // Chasers are spread left/right by 5 units.
           const spawnX = ship.x + (fwdX * 32) + (rightX * offX);
           const spawnY = ship.y + (fwdY * 32) + (rightY * offX);

           spawnProjectile(spawnX, spawnY, ship.rotation, owner);
      });
  };

  const fireCannons = (ship: Ship, owner: 'player'|'enemy', angleOffset: number) => {
      // Cannon positions along the hull (local Y coordinates in the drawing function)
      // These correspond to "forward/backward" along the ship length.
      const longitudinalOffsets = [-15, -5, 5]; 
      // Distance from center to side (width)
      const lateralDist = 16; 
      
      const fwdX = Math.cos(ship.rotation);
      const fwdY = Math.sin(ship.rotation);
      const rightX = -Math.sin(ship.rotation);
      const rightY = Math.cos(ship.rotation);

      // angleOffset is -PI/2 (Port/Left) or +PI/2 (Starboard/Right)
      // If firing Port, we use -Right vector.
      const isPort = angleOffset < 0;
      const sideDir = isPort ? -1 : 1;

      longitudinalOffsets.forEach(fwdOffset => { 
          // Offset Logic:
          // The drawing has -Y as "Up" or Bow. 
          // Physics Fwd (+X) corresponds to visual Up (-Y).
          // So a visual offset of -15 (towards bow) means +15 in physics forward direction.
          // Calculation: fwdX * -(-15) = fwdX * 15. Correct.
          
          const spawnX = ship.x + (fwdX * -fwdOffset) + (rightX * (sideDir * lateralDist));
          const spawnY = ship.y + (fwdY * -fwdOffset) + (rightY * (sideDir * lateralDist));

          // Fire direction
          const fireAngle = ship.rotation + angleOffset;
          
          // Add spread
          const spread = (Math.random() - 0.5) * 0.2;
          
          spawnProjectile(spawnX, spawnY, fireAngle + spread, owner);
      });
  }

  const spawnProjectile = (x: number, y: number, angle: number, owner: 'player' | 'enemy') => {
      const s = gameState.current;
      
      // Muzzle Flash
      s.particles.push({
          id: Math.random(), x: x, y: y, radius:0, rotation:0, active:true,
          velocity: { x: Math.cos(angle)*2, y: Math.sin(angle)*2 },
          life: 0.3, maxLife: 0.3, color: 'rgba(255,200,100,0.8)', size: randomRange(5,8), type:'muzzle'
      });
      // Smoke
      s.particles.push({
        id: Math.random(), x: x, y: y, radius:0, rotation:0, active:true,
        velocity: { x: Math.cos(angle), y: Math.sin(angle) },
        life: 0.6, maxLife: 0.6, color: 'rgba(200,200,200,0.4)', size: randomRange(4,7), type:'smoke'
      });

      s.projectiles.push({
          id: Math.random(),
          x: x,
          y: y,
          radius: 3, rotation: 0, active: true,
          velocity: {
              x: Math.cos(angle) * CANNON_SPEED,
              y: Math.sin(angle) * CANNON_SPEED
          },
          owner: owner,
          damage: 10
      });
  };

  const drawStar = (ctx: CanvasRenderingContext2D, cx: number, cy: number, spikes: number, outerRadius: number, innerRadius: number) => {
    let rot = Math.PI / 2 * 3;
    let x = cx;
    let y = cy;
    let step = Math.PI / spikes;

    ctx.beginPath();
    ctx.moveTo(cx, cy - outerRadius);
    for (let i = 0; i < spikes; i++) {
        x = cx + Math.cos(rot) * outerRadius;
        y = cy + Math.sin(rot) * outerRadius;
        ctx.lineTo(x, y);
        rot += step;

        x = cx + Math.cos(rot) * innerRadius;
        y = cy + Math.sin(rot) * innerRadius;
        ctx.lineTo(x, y);
        rot += step;
    }
    ctx.lineTo(cx, cy - outerRadius);
    ctx.closePath();
    ctx.fill();
  }

  // --- REALISTIC SHIP RENDERER ---
  const drawRealisticShip = (ctx: CanvasRenderingContext2D, ship: Ship, type: 'player' | 'pirate', time: number) => {
    ctx.save();
    ctx.translate(ship.x, ship.y);
    
    // Slight roll simulation
    const roll = Math.sin(time * 3 + ship.wobbleOffset) * 0.08;
    // Add "pitch" based on velocity for speed feel
    const pitch = Math.min(0.1, Math.hypot(ship.velocity.x, ship.velocity.y) * 0.02);
    
    // CORRECTIVE ROTATION:
    // Physics Rotation 0 = East (+X).
    // Ship Art has Bow at -Y (Up).
    // To align "Up" art with "East" physics, rotate +90 deg (PI/2).
    ctx.rotate(ship.rotation + Math.PI / 2 + roll);

    // Scaling
    const scale = type === 'player' ? 1.2 : 1.0;
    ctx.scale(scale, scale);

    // Colors
    const isPlayer = type === 'player';
    const colors = isPlayer ? {
        hullBase: '#7f1d1d', // Red 900
        hullHighlight: '#dc2626', // Red 600
        deck: '#d4a373',
        trim: '#fbbf24', // Amber 400
        sail: '#fefce8',
        sailStripe: '#ef4444',
        mast: '#f59e0b'
    } : {
        hullBase: '#1a0f0a',
        hullHighlight: '#4a3b32',
        deck: '#5c4033',
        trim: '#525252',
        sail: '#171717',
        sailStripe: '#333',
        mast: '#261a15'
    };

    // --- Hull Construction ---
    // Shadow
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 15;
    ctx.shadowOffsetX = 10;
    ctx.shadowOffsetY = 10;

    const drawHullShape = () => {
        ctx.beginPath();
        ctx.moveTo(0, -32); // Bow tip (Visually Up, aligned to Physics Right via rotation)
        // Starboard side
        ctx.bezierCurveTo(16, -20, 18, 15, 14, 28);
        ctx.lineTo(-14, 28); // Stern
        // Port side
        ctx.bezierCurveTo(-18, 15, -16, -20, 0, -32);
        ctx.closePath();
    };

    // 1. Hull Base
    ctx.fillStyle = colors.hullBase;
    drawHullShape();
    ctx.fill();
    
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // 2. Hull Gradient
    const hullGrad = ctx.createLinearGradient(-15, 0, 15, 0);
    hullGrad.addColorStop(0, 'rgba(0,0,0,0.4)');
    hullGrad.addColorStop(0.2, colors.hullHighlight);
    hullGrad.addColorStop(0.5, colors.hullHighlight); 
    hullGrad.addColorStop(0.8, colors.hullHighlight);
    hullGrad.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = hullGrad;
    drawHullShape();
    ctx.fill();

    // 3. Deck
    ctx.fillStyle = colors.deck;
    ctx.beginPath();
    ctx.moveTo(0, -28);
    ctx.bezierCurveTo(12, -18, 14, 15, 11, 25);
    ctx.lineTo(-11, 25);
    ctx.bezierCurveTo(-14, 15, -12, -18, 0, -28);
    ctx.fill();

    // Wood plank lines
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for(let i=-8; i<=8; i+=4) {
        ctx.moveTo(i, -20);
        ctx.lineTo(i, 22);
    }
    ctx.stroke();

    // 4. Rear Cabin
    ctx.fillStyle = colors.hullBase;
    ctx.beginPath();
    // @ts-ignore
    if (ctx.roundRect) ctx.roundRect(-12, 12, 24, 14, 2);
    else ctx.rect(-12, 12, 24, 14);
    ctx.fill();
    ctx.fillStyle = colors.hullHighlight;
    ctx.beginPath();
    // @ts-ignore
    if (ctx.roundRect) ctx.roundRect(-11, 13, 22, 12, 1);
    else ctx.rect(-11, 13, 22, 12);
    ctx.fill();

    // 5. Trim
    ctx.strokeStyle = colors.trim;
    ctx.lineWidth = 2;
    drawHullShape();
    ctx.stroke();

    // 6. Cannons
    ctx.fillStyle = '#1c1917';
    // Broadside ports
    const cannonPositions = [-15, -5, 5];
    cannonPositions.forEach(y => {
        // Port
        ctx.beginPath(); ctx.rect(-16, y, 4, 3); ctx.fill();
        // Starboard
        ctx.beginPath(); ctx.rect(12, y, 4, 3); ctx.fill();
    });
    
    // Enemy Bow Chasers
    if (!isPlayer) {
        ctx.fillStyle = '#333';
        // Left Chaser
        ctx.beginPath(); 
        ctx.ellipse(-5, -28, 2, 5, 0, 0, Math.PI*2);
        ctx.fill();
        // Right Chaser
        ctx.beginPath(); 
        ctx.ellipse(5, -28, 2, 5, 0, 0, Math.PI*2);
        ctx.fill();
    }

    // 7. Presents (Santa)
    if (isPlayer) {
        const presentColors = ['#ef4444', '#22c55e', '#3b82f6', '#eab308'];
        const drawPresent = (px: number, py: number, w: number, h: number, c: string) => {
             ctx.fillStyle = c;
             ctx.fillRect(px, py, w, h);
             ctx.strokeStyle = 'rgba(255,255,255,0.5)';
             ctx.lineWidth = 1;
             ctx.strokeRect(px, py, w, h);
             ctx.fillStyle = 'white';
             ctx.fillRect(px + w/2 - 1, py, 2, h);
             ctx.fillRect(px, py + h/2 - 1, w, 2);
        };
        drawPresent(-6, 0, 6, 6, presentColors[0]);
        drawPresent(2, 2, 5, 5, presentColors[1]);
        drawPresent(-2, 5, 4, 4, presentColors[2]);
    }

    // 8. Masts & Sails
    const drawMast = (x: number, y: number, height: number, width: number) => {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath(); ctx.ellipse(x + 5, y + 5, 3, 3, 0, 0, Math.PI*2); ctx.fill();

        ctx.fillStyle = colors.mast;
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI*2); ctx.fill();

        ctx.strokeStyle = '#4b2e2e';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x - width/2, y + 2); ctx.lineTo(x + width/2, y + 2); ctx.stroke();

        const sailWobble = Math.sin(time * 4) * 1.5;
        // Billow effect from speed
        const billow = Math.min(5, Math.hypot(ship.velocity.x, ship.velocity.y) * 2);
        
        const gradSail = ctx.createLinearGradient(x, y+4, x, y+20);
        gradSail.addColorStop(0, colors.sail);
        gradSail.addColorStop(1, '#e5e5e5');

        ctx.fillStyle = gradSail;
        ctx.beginPath();
        ctx.moveTo(x - width/2, y + 2);
        ctx.lineTo(x + width/2, y + 2);
        ctx.quadraticCurveTo(x + width/2 + 2, y + 15 + billow, x + width/2, y + 18 + sailWobble + billow);
        ctx.quadraticCurveTo(x, y + 14 + sailWobble + billow, x - width/2, y + 18 + sailWobble + billow);
        ctx.quadraticCurveTo(x - width/2 - 2, y + 15 + billow, x - width/2, y + 2);
        ctx.fill();

        if (isPlayer) {
             ctx.strokeStyle = 'rgba(220, 38, 38, 0.2)';
             ctx.lineWidth = 4;
             ctx.beginPath(); ctx.moveTo(x, y+2); ctx.lineTo(x, y+16+sailWobble+billow); ctx.stroke();
        }
        
        if (!isPlayer) {
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            ctx.beginPath(); ctx.arc(x, y + 10 + billow/2, 3, 0, Math.PI*2); ctx.fill();
            ctx.fillRect(x-2, y+12+billow/2, 4, 2);
        }
    };

    drawMast(0, 5, 20, 28);
    drawMast(0, -18, 15, 20);

    ctx.strokeStyle = colors.mast;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, -32); ctx.lineTo(0, -42); ctx.stroke();

    ctx.restore();
  };

  const deliverPresent = async (island: Island) => {
      island.delivered = true;
      setScore(prev => prev + 500);
      setLoadingMessage(true);
      
      const text = await generatePirateEvent("Delivered Present", `Delivered to ${island.name}`);
      setLoadingMessage(false);
      setMessage(text);
  };

  // --- UI ---
  return (
    <div className="relative w-full h-screen bg-zinc-900 overflow-hidden font-sans select-none">
      
      {!gameStarted ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md">
            <div className="text-center space-y-6 max-w-lg p-10 border border-zinc-700 rounded-2xl bg-zinc-900/90 shadow-[0_0_50px_rgba(0,0,0,0.5)]">
                <div className="mb-4 text-6xl">🏴‍☠️🎁</div>
                <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-br from-yellow-400 to-yellow-600">
                    Santa's Pirate Seas
                </h1>
                <p className="text-zinc-300 text-lg leading-relaxed">
                    Master the waves! Presents must be delivered, and pirates must be sunk.
                </p>
                <div className="grid grid-cols-2 gap-4 text-left bg-black/40 p-6 rounded-xl text-sm text-zinc-400 font-mono border border-zinc-800">
                    <div className="text-yellow-500 font-bold">W</div> <div>Hoist Sails (Accelerate)</div>
                    <div className="text-yellow-500 font-bold">A / D</div> <div>Port / Starboard (Steer)</div>
                    <div className="text-yellow-500 font-bold">SPACE</div> <div>Fire Broadsides</div>
                </div>
                <button 
                    onClick={() => { setGameStarted(true); initGame(); }}
                    className="w-full py-4 bg-yellow-600 hover:bg-yellow-500 text-black font-bold rounded-xl text-xl transition-all hover:scale-105 active:scale-95 shadow-lg"
                >
                    SET SAIL
                </button>
            </div>
        </div>
      ) : null}

      <canvas 
        ref={canvasRef}
        width={window.innerWidth}
        height={window.innerHeight}
        className="block w-full h-full cursor-crosshair"
      />

      <div className="absolute top-0 left-0 w-full p-6 pointer-events-none flex justify-between items-start z-10">
         <div className="flex flex-col gap-2 animate-in slide-in-from-top duration-700">
             <div className="bg-black/60 backdrop-blur border border-white/10 px-6 py-3 rounded-xl shadow-lg">
                 <div className="text-zinc-400 text-xs font-bold uppercase tracking-wider mb-1">Bounty</div>
                 <div className="text-3xl font-mono text-yellow-400 drop-shadow-md">{score.toLocaleString()}</div>
             </div>
             
             <div className="w-36 h-36 bg-black/80 rounded-full border-2 border-zinc-700 relative overflow-hidden hidden md:block opacity-90 shadow-2xl">
                 <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle,transparent_0%,#000_100%)]"></div>
                 <div className="absolute inset-0 border-b border-green-500/30 animate-[spin_4s_linear_infinite] origin-center"></div>
                 <div className="absolute top-1/2 left-1/2 w-1.5 h-1.5 bg-white rounded-full -translate-x-1/2 -translate-y-1/2 z-10 shadow-[0_0_10px_white]"></div>
                 {gameState.current && gameState.current.islands.map(i => {
                     const dx = (i.x - gameState.current.player.x) / 30;
                     const dy = (i.y - gameState.current.player.y) / 30;
                     if (Math.hypot(dx, dy) > 65) return null;
                     return (
                        <div key={i.id} className={`absolute w-2 h-2 rounded-full ${i.delivered ? 'bg-green-500' : 'bg-yellow-400 animate-pulse'}`} style={{ top: `calc(50% + ${dy}px)`, left: `calc(50% + ${dx}px)` }}></div>
                     )
                 })}
                  {gameState.current && gameState.current.enemies.map(e => {
                     if (!e.active) return null;
                     const dx = (e.x - gameState.current.player.x) / 30;
                     const dy = (e.y - gameState.current.player.y) / 30;
                     if (Math.hypot(dx, dy) > 65) return null;
                     return (
                        <div key={e.id} className="absolute w-2 h-2 bg-red-500 rounded-full" style={{ top: `calc(50% + ${dy}px)`, left: `calc(50% + ${dx}px)` }}></div>
                     )
                 })}
             </div>
         </div>

         <div className="flex flex-col items-end gap-3 animate-in slide-in-from-right duration-700">
            <button className="pointer-events-auto p-3 bg-zinc-800/80 rounded-full hover:bg-zinc-700 transition-colors border border-white/10" onClick={() => setSoundEnabled(!soundEnabled)}>
                {soundEnabled ? <SpeakerWaveIcon className="w-5 h-5 text-white" /> : <SpeakerXMarkIcon className="w-5 h-5 text-zinc-500" />}
            </button>
            <div className="flex items-center gap-3 bg-black/60 backdrop-blur border border-white/10 px-4 py-2 rounded-lg">
                 <div className="text-zinc-400 text-xs font-bold uppercase">Hull Integrity</div>
                 <div className="w-32 h-3 bg-zinc-800 rounded-full overflow-hidden">
                    <div 
                        className={`h-full transition-all duration-300 ${gameState.current?.player.health > 50 ? 'bg-green-500' : gameState.current?.player.health > 25 ? 'bg-yellow-500' : 'bg-red-500 animate-pulse'}`} 
                        style={{ width: `${Math.max(0, gameState.current?.player.health)}%` }}
                    ></div>
                 </div>
            </div>
         </div>
      </div>

      {(message || loadingMessage) && (
          <div className="absolute inset-0 z-40 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-all animate-in fade-in duration-300">
              <div className="bg-[#e7e5e4] max-w-lg w-full p-1 rounded-sm shadow-2xl transform rotate-1 relative">
                  <div className="border-4 border-[#78350f] p-8 h-full bg-[url('https://www.transparenttextures.com/patterns/aged-paper.png')] relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-[#78350f]"></div>
                    <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-[#78350f]"></div>
                    <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-[#78350f]"></div>
                    <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-[#78350f]"></div>
                    <h3 className="text-[#78350f] text-2xl font-serif font-black mb-6 flex items-center justify-center gap-3 border-b-2 border-[#78350f]/20 pb-4">
                        {loadingMessage ? (
                            <>
                                <span className="animate-spin text-3xl">☸️</span>
                                <span>Charting Course...</span>
                            </>
                        ) : (
                            <>
                                <span className="text-3xl">📜</span>
                                <span>Captain's Log</span>
                            </>
                        )}
                    </h3>
                    <div className="text-[#451a03] font-serif text-xl leading-relaxed text-center min-h-[5rem] flex items-center justify-center">
                        {loadingMessage ? "The stars are aligning..." : message}
                    </div>
                    {!loadingMessage && (
                        <button 
                            onClick={() => setMessage(null)}
                            className="mt-8 w-full py-3 bg-[#78350f] hover:bg-[#92400e] text-[#fef3c7] font-bold uppercase tracking-widest rounded shadow-lg transition-colors border-2 border-[#451a03]"
                        >
                            Continue Voyage
                        </button>
                    )}
                  </div>
              </div>
          </div>
      )}

      {gameOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-red-950/90 backdrop-blur-md">
             <div className="text-center space-y-8 animate-in zoom-in duration-500 p-12 border-4 border-red-500 rounded-3xl bg-black/50">
                <div className="text-8xl mb-4">☠️</div>
                <h2 className="text-7xl font-black text-red-500 tracking-tighter uppercase drop-shadow-[0_5px_5px_rgba(0,0,0,0.8)]">Shipwrecked</h2>
                <div className="text-2xl text-zinc-300 font-mono">
                    Bounty Collected: <span className="text-yellow-400 font-bold text-4xl">{score.toLocaleString()}</span>
                </div>
                <button 
                    onClick={initGame}
                    className="px-12 py-4 bg-white text-red-900 font-black text-xl rounded-full hover:scale-110 transition-transform shadow-[0_0_30px_rgba(255,255,255,0.3)]"
                >
                    TRY AGAIN
                </button>
             </div>
        </div>
      )}

    </div>
  );
};

export default App;