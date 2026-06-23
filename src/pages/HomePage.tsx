import './HomePage.css';
import { useNavigate } from 'react-router-dom';
import { useState, useCallback } from 'react';

const emojis = ['🐟','🐠','🦀','🐚','🐡','🦐','🐬','🐋','🦈','🐙'];

function HomePage() {
  const navigate = useNavigate();
  const [critters, setCritters] = useState<Array<{id:number, x:number, y:number, emoji:string, dx:number, dy:number}>>([]);
  const [ripples, setRipples] = useState<Array<{id:number, x:number, y:number}>>([]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = Date.now();

    setRipples(prev => [...prev, { id, x, y }]);
    setTimeout(() => setRipples(prev => prev.filter(r => r.id !== id)), 800);

    // 随机弹出 2-4 个生物
    const count = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const dx = (Math.random() - 0.5) * 300;
      const dy = -(80 + Math.random() * 160);
      setCritters(prev => [...prev, {
        id: id + i,
        x, y,
        emoji: emojis[Math.floor(Math.random() * emojis.length)],
        dx, dy,
      }]);
      setTimeout(() => setCritters(prev => prev.filter(c => c.id !== id + i)), 1200);
    }
  }, []);

  return (
    <div className="home-page" onClick={handleClick}>
      <div className="wave-bg">
        <svg viewBox="0 0 1440 320" preserveAspectRatio="none" className="wave wave-1">
          <path fill="rgba(59,130,246,0.15)" d="M0,160 C240,260 480,60 720,160 C960,260 1200,60 1440,160 L1440,320 L0,320 Z" />
        </svg>
        <svg viewBox="0 0 1440 400" preserveAspectRatio="none" className="wave wave-2">
          <path fill="rgba(37,99,235,0.2)" d="M0,200 C320,80 560,300 880,180 C1120,80 1360,280 1440,200 L1440,400 L0,400 Z" />
        </svg>
        <svg viewBox="0 0 1440 480" preserveAspectRatio="none" className="wave wave-3">
          <path fill="rgba(29,78,216,0.12)" d="M0,280 C200,180 440,350 720,250 C1000,150 1300,320 1440,260 L1440,480 L0,480 Z" />
        </svg>
      </div>

      <div className="light-beam" />

      {ripples.map(r => (
        <div key={r.id} className="ripple" style={{ left: r.x, top: r.y }} />
      ))}

      {critters.map(c => (
        <span key={c.id} className="critter" style={{
          left: c.x,
          top: c.y,
          '--dx': `${c.dx}px`,
          '--dy': `${c.dy}px`,
        } as React.CSSProperties}>
          {c.emoji}
        </span>
      ))}

      <div className="home-center">
        <h1 className="home-title">长江崩岸监测预警应用系统</h1>
        <p className="home-subtitle">YRCW · Yangtze River Collapse Warning</p>
        <button className="start-btn" onClick={() => navigate('/editor')}>进入系统</button>
      </div>
    </div>
  );
}

export default HomePage;
