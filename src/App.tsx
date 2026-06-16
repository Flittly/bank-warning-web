import { useState } from 'react';
import { Edit3, BarChart2, Home, Layout, BookOpen } from 'lucide-react';
import HomePage from './pages/HomePage';
import EditorPage from './pages/EditorPage';
import ResultPage from './pages/ResultPage';
import KnowledgePage from './pages/KnowledgePage';
import './App.css';

type PageState = 
  | { type: 'home' }
  | { type: 'editor' }
  | { type: 'result'; taskId?: string }
  | { type: 'knowledge' };

function App() {
  const [pageState, setPageState] = useState<PageState>({ type: 'home' });

  const currentPage = pageState.type;

  const setPage = (page: 'home' | 'editor' | 'result' | 'knowledge', taskId?: string) => {
    if (page === 'home') {
      setPageState({ type: 'home' });
    } else if (page === 'editor') {
      setPageState({ type: 'editor' });
    } else if (page === 'result') {
      setPageState({ type: 'result', taskId });
    } else if (page === 'knowledge') {
      setPageState({ type: 'knowledge' });
    }
  };

  if (currentPage === 'home') {
    return <HomePage onNavigate={() => setPage('editor')} />;
  }

  const renderNav = () => (
    <div className="main-nav">
      <div className="nav-logo" onClick={() => setPage('home')}>
        <Layout size={20} />
        <span>崩岸计算器</span>
      </div>
      <div className="nav-tabs">
        <button 
          type="button"
          className={`nav-tab ${currentPage === 'editor' ? 'active' : ''}`}
          onClick={() => setPage('editor')}
        >
          <Edit3 size={18} />
            断面编辑器
        </button>
        <button 
          type="button"
          className={`nav-tab ${currentPage === 'result' ? 'active' : ''}`}
          onClick={() => setPage('result')}
        >
          <BarChart2 size={18} />
          结果查看器
        </button>
        <button 
          type="button"
          className={`nav-tab ${currentPage === 'knowledge' ? 'active' : ''}`}
          onClick={() => setPage('knowledge')}
        >
          <BookOpen size={18} />
          知识库
        </button>
      </div>
      <button className="nav-home" type="button" onClick={() => setPage('home')} title="返回首页" aria-label="返回首页">
        <Home size={18} />
      </button>
    </div>
  );

  const renderPage = () => {
    switch (currentPage) {
      case 'editor': return <EditorPage setPage={setPage} />;
      case 'result': return <ResultPage initialTaskId={pageState.type === 'result' ? pageState.taskId : undefined} />;
      case 'knowledge': return <KnowledgePage />;
      default: return null;
    }
  };

  return (
    <div className="app-container">
      {renderNav()}
      <main className="app-main">
        {renderPage()}
      </main>
    </div>
  );
}

export default App;
