import './HomePage.css';
import { useNavigate } from 'react-router-dom';

interface HomePageProps {
  onNavigate?: () => void;
}

function HomePage({ onNavigate }: HomePageProps) {
  const navigate = useNavigate();

  const handleStart = () => {
    if (onNavigate) return onNavigate();
    navigate('/editor');
  };

  return (
    <div className="home-page">
      <div className="home-container">
        <div className="home-content">
          <h1 className="home-title">崩岸分析系统</h1>
          <p className="home-subtitle">Bank Line Analysis System</p>

          <button className="start-button" onClick={handleStart}>
            开始使用
            <span className="button-arrow">→</span>
          </button>

          <div className="home-footer">
            <p>支持 GeoJSON 格式 | 基于 Mapbox GL JS</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HomePage;
// 新建task