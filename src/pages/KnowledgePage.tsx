import { useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import ResizeHandle from '../components/ResizeHandle';
import KnowledgeSidebar from './KnowledgeSidebar';
import KnowledgePreview from './KnowledgePreview';
import type { SearchResult } from '../services/knowledgeApi';
import { searchKnowledge } from '../services/knowledgeApi';

export default function KnowledgePage() {
  const [searchParams] = useSearchParams();
  const initialDoc = searchParams.get('doc') || null;
  const [leftWidth, setLeftWidth] = useState(360);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(initialDoc);
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const handleSelectDoc = useCallback((id: string) => {
    setSelectedDocId(id);
    setSearchResults(null);
    setSearchQuery('');
  }, []);

  const handleSearch = useCallback(async (query: string) => {
    if (!query) {
      setSearchResults(null);
      setSearchQuery('');
      return;
    }
    setSearchQuery(query);
    try {
      const results = await searchKnowledge(query);
      setSearchResults(results);
      setSelectedDocId(null);
    } catch (e) {
      console.error('Search failed:', e);
    }
  }, []);

  return (
    <div className="editor-layout">
      <KnowledgeSidebar
        onSelectDoc={handleSelectDoc}
        onSearch={handleSearch}
        style={{ width: leftWidth, minWidth: leftWidth }}
      />
      <ResizeHandle onResize={delta => setLeftWidth(w => Math.max(280, Math.min(500, w + delta)))} />
      <KnowledgePreview
        selectedDocId={selectedDocId}
        searchResults={searchResults}
        searchQuery={searchQuery}
        style={{ flex: 1, height: '100%', minWidth: 0 }}
      />
    </div>
  );
}
