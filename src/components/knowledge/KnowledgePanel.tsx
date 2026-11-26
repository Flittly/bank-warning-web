import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BookOpen, ExternalLink, FileText, RefreshCw, Search, Trash2, Upload } from 'lucide-react';
import { Button, Input, Modal, Spin, Tooltip } from 'antd';
import {
  deleteDocument,
  fetchDocumentDetail,
  fetchKnowledgeList,
  fetchKnowledgeStats,
  searchKnowledge,
  uploadKnowledgePdf,
  uploadKnowledgeText,
  type KnowledgeDoc,
  type KnowledgeDocDetail,
  type KnowledgeStats,
  type SearchResult,
} from '../../services/knowledgeApi';
import ConfirmModal from '../ConfirmModal';
import styles from './KnowledgePanel.module.css';

/**
 * 断面编辑器左栏的「知识库」面板。
 *
 * <p>为什么需要它：工作区活动条原来有 6 个按钮，其中 5 个都留在工作区壳内
 * （`/editor` 或 `/result?panel=…`），只有「知识库」跳去 `/knowledge`。
 * 而 `/knowledge` 是"中心页"，一进去 `AppLayout` 的 `railMode` 就从 `work` 切成 `home`，
 * 左栏从 42px 图标条变成 66px 悬浮圆角卡 —— 视觉上等于退回了首页那套外壳，
 * 编辑器里的地图、断面选择、正在调的分幅全部重挂载。所以知识库改成在左栏内切换。
 *
 * <p>与 `/knowledge` 知识中心的分工：
 * - 这里是**编辑器内的精简版**：列表 + 本地过滤 + 语义检索 + 上传 + 删除 + 读正文（弹窗）。
 * - 260px 侧栏放不下「左列表 + 右预览」的两栏正文，所以正文走弹窗；
 *   需要完整能力（类型 chip 筛选、公开标记、分块统计）时走底栏的「知识中心」跳转。
 */
export default function KnowledgePanel() {
  const navigate = useNavigate();

  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  /** 输入框内容：只做本地过滤（文件名 / docId），不触网。 */
  const [query, setQuery] = useState('');
  /** 语义检索结果；`null` = 当前在看列表，非 null = 当前在看命中片段。 */
  const [hits, setHits] = useState<SearchResult[] | null>(null);
  const [hitQuery, setHitQuery] = useState('');
  const [hitting, setHitting] = useState(false);

  const [detail, setDetail] = useState<KnowledgeDocDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadType, setUploadType] = useState('文档');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<KnowledgeDoc | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchKnowledgeList(), fetchKnowledgeStats()])
      .then(([list, summary]) => {
        if (cancelled) return;
        setDocs(list);
        setStats(summary);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '文档列表加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return docs;
    return docs.filter(
      (doc) =>
        (doc.fileName || '').toLowerCase().includes(keyword) ||
        doc.docId.toLowerCase().includes(keyword),
    );
  }, [docs, query]);

  const openDetail = useCallback((docId: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    fetchDocumentDetail(docId)
      .then((result) => setDetail(result))
      .catch((reason: unknown) =>
        setDetailError(reason instanceof Error ? reason.message : '文档内容加载失败'),
      )
      .finally(() => setDetailLoading(false));
  }, []);

  const runSearch = useCallback(async () => {
    const keyword = query.trim();
    if (!keyword) {
      setHits(null);
      setHitQuery('');
      return;
    }
    setHitting(true);
    setHitQuery(keyword);
    try {
      setHits(await searchKnowledge(keyword));
    } catch (reason: unknown) {
      setHits([]);
      setError(reason instanceof Error ? reason.message : '语义检索失败');
    } finally {
      setHitting(false);
    }
  }, [query]);

  const backToList = () => {
    setHits(null);
    setHitQuery('');
  };

  /** 选文件后先问分类，再上传：`window.prompt` 在部分内核里被拦截且不可键盘取消。 */
  const handleFilePicked = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setPendingFile(file);
    setUploadType('文档');
  };

  const confirmUpload = async () => {
    const file = pendingFile;
    if (!file) return;
    const type = uploadType.trim() || '文档';
    setUploading(true);
    try {
      const result =
        file.name.endsWith('.pdf') || file.name.endsWith('.docx')
          ? await uploadKnowledgePdf(file, type, false)
          : await uploadKnowledgeText(type, file.name, await file.text(), false);
      setPendingFile(null);
      setReloadKey((key) => key + 1);
      // 后端口径（KnowledgeController.finishIngest）：只要有一段没嵌成功就 discardStaged()，
      // 整批作废、旧版本留在库里。所以这里是"一段都没进库"，不是"部分检索不到"。
      if (result.failed && result.failed > 0) {
        setError(`${result.failed} 段嵌入失败，本批作废，库中仍是上一版内容`);
      } else if (result.success === false) {
        setError(result.error || '入库未生效，库中仍是上一版内容');
      }
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const confirmDelete = async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleting(true);
    try {
      await deleteDocument(target.docId);
      setDeleteTarget(null);
      setHits(null);
      setReloadKey((key) => key + 1);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  const summaryText = stats
    ? `${stats.documents} 文档 · ${stats.chunks} 分块`
    : `${docs.length} 文档`;

  return (
    <div className={styles.panel}>
      <div className="sidebar-header" style={{ padding: '12px 14px 8px', margin: 0, flexShrink: 0 }}>
        <BookOpen size={14} />
        <h4>知识库</h4>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.searchRow}>
          <Input
            size="small"
            allowClear
            placeholder="搜索文档 / 回车语义检索"
            prefix={<Search size={13} style={{ color: '#94a3b8' }} />}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              // 清空输入就退回列表，否则"退不出检索结果"要靠找返回按钮
              if (!event.target.value) backToList();
            }}
            onPressEnter={() => void runSearch()}
          />
          <Tooltip title="语义检索（走向量召回）">
            <Button size="small" loading={hitting} onClick={() => void runSearch()}>
              检索
            </Button>
          </Tooltip>
        </div>

        <button
          type="button"
          className={styles.uploadBtn}
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={13} />
          {uploading ? '上传中…' : '上传文档 (PDF / DOCX / TXT / MD)'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.txt,.md"
          style={{ display: 'none' }}
          onChange={handleFilePicked}
        />
      </div>

      {error && (
        <div className={styles.error} role="alert">
          {error}
          <button
            type="button"
            className={styles.backBtn}
            onClick={() => {
              setError(null);
              setReloadKey((key) => key + 1);
            }}
          >
            <RefreshCw size={11} style={{ verticalAlign: -1, marginRight: 3 }} />
            重试
          </button>
        </div>
      )}

      <div className={styles.listZone}>
        {hits !== null ? (
          <>
            <div className={styles.listHead}>
              <strong>检索「{hitQuery}」</strong>
              <span className={styles.count}>{hits.length} 条</span>
              <button type="button" className={styles.backBtn} onClick={backToList}>
                返回列表
              </button>
            </div>
            {hitting && (
              <div className={styles.state}>
                <Spin size="small" />
                检索中…
              </div>
            )}
            {!hitting && hits.length === 0 && <div className={styles.state}>没有命中片段</div>}
            {!hitting &&
              hits.map((hit, index) => (
                <button
                  key={`${hit.docId}-${hit.chunkIndex ?? index}`}
                  type="button"
                  className={styles.hit}
                  onClick={() => openDetail(hit.docId)}
                  title="打开所属文档"
                >
                  <span className={styles.hitHead}>
                    <span className={styles.hitSource}>
                      {hit.sourceLabel || hit.docId}
                    </span>
                    {/* 关键词路单命中的结果没有分数（score = null），不能显示成 0.000 */}
                    {typeof hit.score === 'number' && (
                      <span className={styles.hitScore}>{hit.score.toFixed(3)}</span>
                    )}
                  </span>
                  <span className={styles.hitText}>{hit.content}</span>
                </button>
              ))}
          </>
        ) : (
          <>
            <div className={styles.listHead}>
              <strong>知识文档</strong>
              <span className={styles.count}>
                {query.trim() ? `${filtered.length} / ${docs.length}` : `${docs.length} 个`}
              </span>
            </div>

            {loading && (
              <div className={styles.state}>
                <Spin size="small" />
                加载中…
              </div>
            )}

            {!loading && filtered.length === 0 && (
              <div className={styles.state}>
                <FileText size={28} color="#cbd5e1" />
                <span>{docs.length === 0 ? '暂无文档，先上传一份' : '没有匹配的文档'}</span>
              </div>
            )}

            {!loading &&
              filtered.map((doc) => (
                <div key={doc.docId} className={styles.row} role="button" tabIndex={0}
                  onClick={() => openDetail(doc.docId)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openDetail(doc.docId);
                    }
                  }}
                >
                  <FileText size={15} className={styles.rowIcon} />
                  <span className={styles.rowBody}>
                    <span className={styles.rowTitle}>{doc.fileName || doc.docId}</span>
                    <span className={styles.rowMeta}>
                      <span className={styles.chip}>{doc.type || '未分类'}</span>
                      <span className={styles.metaText}>{doc.chunks} 分块</span>
                    </span>
                  </span>
                  <button
                    type="button"
                    className={styles.deleteBtn}
                    title="删除文档"
                    aria-label={`删除 ${doc.fileName || doc.docId}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setDeleteTarget(doc);
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
          </>
        )}
      </div>

      <div className={styles.footer}>
        <span className={styles.footerText}>{summaryText}</span>
        <button
          type="button"
          className={styles.footerLink}
          onClick={() => navigate('/knowledge')}
          title="打开完整知识中心（类型筛选 / 公开标记 / 全文预览）"
        >
          知识中心
          <ExternalLink size={10} style={{ verticalAlign: -1, marginLeft: 2 }} />
        </button>
      </div>

      <Modal
        open={detailOpen}
        title={detail?.fileName || '文档内容'}
        width={760}
        footer={null}
        onCancel={() => setDetailOpen(false)}
        destroyOnHidden
      >
        {detailLoading && (
          <div style={{ padding: '40px 0', textAlign: 'center' }}>
            <Spin />
          </div>
        )}
        {!detailLoading && detailError && <div className={styles.error}>{detailError}</div>}
        {!detailLoading && !detailError && detail && (
          <div className={styles.detailBody}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{detail.content || '（正文为空）'}</ReactMarkdown>
          </div>
        )}
      </Modal>

      <Modal
        open={pendingFile !== null}
        title="上传知识文档"
        okText={uploading ? '上传中…' : '上传'}
        cancelText="取消"
        confirmLoading={uploading}
        onOk={() => void confirmUpload()}
        onCancel={() => {
          if (!uploading) setPendingFile(null);
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 13, color: '#475569' }}>
            文件：{pendingFile?.name}
          </span>
          <Input
            addonBefore="分类"
            value={uploadType}
            onChange={(event) => setUploadType(event.target.value)}
            placeholder="如 hydraulic / engineering"
            onPressEnter={() => void confirmUpload()}
          />
          <span style={{ fontSize: 12, color: '#94a3b8' }}>
            分类决定列表里的标签与检索时的分路，同一个分类请保持用词一致。
          </span>
        </div>
      </Modal>

      {deleteTarget && (
        <ConfirmModal
          title="删除知识文档"
          danger
          confirmText={deleting ? '删除中…' : '删除'}
          content={
            <span>
              将删除「{deleteTarget.fileName || deleteTarget.docId}」及其全部 {deleteTarget.chunks} 个分块。
              删除后该文档无法被检索到，且不可撤销。
            </span>
          }
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
