import type {
  DesignBounds,
  DesignDocument,
  DesignNode,
  DesignTarget,
} from '../../core/models.js';

const STYLE_KEYS = [
  'fills',
  'strokes',
  'strokeWeight',
  'strokeAlign',
  'cornerRadius',
  'rectangleCornerRadii',
  'effects',
  'opacity',
  'blendMode',
  'layoutMode',
  'primaryAxisAlignItems',
  'counterAxisAlignItems',
  'primaryAxisSizingMode',
  'counterAxisSizingMode',
  'itemSpacing',
  'layoutAlign',
  'layoutGrow',
  'constraints',
  'clipsContent',
  'componentPropertyDefinitions',
] as const;

export function normalizeFigmaDocument(raw: unknown, target: DesignTarget): DesignDocument {
  if (!isRecord(raw) || !isRecord(raw.nodes)) {
    throw new Error('Figma response is missing nodes');
  }
  const selected = raw.nodes[target.nodeId] ?? raw.nodes[dashId(target.nodeId)];
  if (!isRecord(selected) || !isRecord(selected.document)) {
    throw new Error(`Figma response is missing selected node ${target.nodeId}`);
  }
  const nodes: Record<string, DesignNode> = {};
  visit(selected.document, nodes, true);
  if (nodes[target.nodeId] === undefined) {
    throw new Error(`Figma selected node ID does not match ${target.nodeId}`);
  }
  return {
    provider: 'figma',
    documentId: target.documentId,
    rootId: target.nodeId,
    nodes,
  };
}

export function safeFigmaRaw(raw: unknown): unknown {
  return sanitize(raw, new Set());
}

function visit(
  raw: Record<string, unknown>,
  nodes: Record<string, DesignNode>,
  ancestorVisible: boolean,
): void {
  if (typeof raw.id !== 'string' || raw.id.length === 0) return;
  const id = colonId(raw.id);
  const children = Array.isArray(raw.children)
    ? raw.children.filter(isRecord).filter((child) => typeof child.id === 'string')
    : [];
  const style: Record<string, unknown> = {};
  for (const key of STYLE_KEYS) {
    if (raw[key] !== undefined) style[key] = sanitize(raw[key], new Set());
  }
  const padding = {
    left: numeric(raw.paddingLeft),
    right: numeric(raw.paddingRight),
    top: numeric(raw.paddingTop),
    bottom: numeric(raw.paddingBottom),
  };
  if (Object.values(padding).some((value) => value !== undefined)) {
    style.padding = Object.fromEntries(Object.entries(padding).filter(([, value]) => value !== undefined));
  }

  const visible = ancestorVisible && raw.visible !== false && raw.opacity !== 0;
  const node: DesignNode = {
    id,
    name: typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : id,
    type: typeof raw.type === 'string' && raw.type.length > 0 ? raw.type : 'UNKNOWN',
    visible,
    bounds: bounds(raw.absoluteBoundingBox),
    children: children.map((child) => colonId(String(child.id))),
    style,
  };
  if (typeof raw.characters === 'string') {
    node.text = {
      characters: raw.characters,
      style: isRecord(raw.style) ? sanitize(raw.style, new Set()) as Record<string, unknown> : {},
    };
  }
  if (typeof raw.componentId === 'string') node.componentRef = colonId(raw.componentId);
  if (isRecord(raw.componentProperties)) {
    node.componentProperties = sanitize(raw.componentProperties, new Set()) as Record<string, unknown>;
  }
  if (needsExport(node.type, raw.fills, raw.strokes, raw.effects, visible)) node.assetRef = id;
  nodes[id] = node;
  for (const child of children) visit(child, nodes, visible);
}

function needsExport(
  type: string,
  fills: unknown,
  strokes: unknown,
  effects: unknown,
  visible: boolean,
): boolean {
  if (!visible) return false;
  if (['COMPONENT', 'INSTANCE'].includes(type)) return true;
  if (['VECTOR', 'BOOLEAN_OPERATION'].includes(type)) {
    return hasVisiblePaint(fills) || hasVisiblePaint(strokes) || hasVisibleEffect(effects);
  }
  return Array.isArray(fills) && fills.some((fill) => (
    isRecord(fill) && fill.type === 'IMAGE' && fill.visible !== false
  ));
}

function hasVisiblePaint(value: unknown): boolean {
  return Array.isArray(value) && value.some((paint) => (
    isRecord(paint) && paint.visible !== false && paint.opacity !== 0
  ));
}

function hasVisibleEffect(value: unknown): boolean {
  return Array.isArray(value) && value.some((effect) => (
    isRecord(effect) && effect.visible !== false
  ));
}

function bounds(value: unknown): DesignBounds | null {
  if (!isRecord(value)) return null;
  const values = ['x', 'y', 'width', 'height'].map((key) => value[key]);
  if (!values.every((item) => typeof item === 'number' && Number.isFinite(item))) return null;
  const [x, y, width, height] = values as number[];
  return { x: x ?? 0, y: y ?? 0, width: width ?? 0, height: height ?? 0 };
}

function sanitize(value: unknown, seen: Set<object>): unknown {
  if (typeof value === 'string') return sanitizeUrl(value);
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value)) throw new Error('Figma source contains a circular value');
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => sanitize(item, seen));
    seen.delete(value);
    return result;
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|authorization|secret/iu.test(key)) continue;
    result[key] = sanitize(item, seen);
  }
  seen.delete(value);
  return result;
}

function sanitizeUrl(value: string): string {
  if (!/^https?:\/\//iu.test(value)) return value;
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/token|authorization|secret|signature|expires/iu.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return '[REDACTED_URL]';
  }
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function colonId(value: string): string {
  return value.replaceAll('-', ':');
}

function dashId(value: string): string {
  return value.replaceAll(':', '-');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
