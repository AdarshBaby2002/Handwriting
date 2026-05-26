/**
 * Handwriting - App Logic
 */

const state = {
    canvas: null,
    ctx: null,
    width: 794,
    height: 1123,
    tool: 'pen',
    penColor: '#000000',
    penSize: 2.0,
    textColor: '#1f2937',
    textSize: 18,
    pages: [],
    pageIndex: 0,
    drawing: false,
    currentStroke: null,
    historyStack: [],
    redoStack: [],
    selectionPath: [],
    hasSelection: false,
    ocrProcessing: false,
    textEditing: null, // { obj, pageIndex }
    draggingText: null, // { object, offset: {x, y} }
    resizingText: null, // { object, initialSize, initialPos }
    selectedText: null, // Persistent selection
    lastPointerPt: null,
    layoutMode: 'pdf' // 'pdf' or 'ppt'
};

const DEFAULT_FONT_FAMILY = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const MALAYALAM_FONT_FAMILY = '"Nirmala UI", "Noto Sans Malayalam", "Kartika", sans-serif';

// --- Initialization ---

function init() {
    state.canvas = document.getElementById('drawingCanvas');
    state.ctx = state.canvas.getContext('2d');
    
    // Remove any leaked print/export nodes from previous sessions.
    document.querySelectorAll('.print-sheet').forEach(s => s.remove());
    
    // Set canvas internal resolution
    state.canvas.width = state.width;
    state.canvas.height = state.height;

    loadFromLocalStorage();
    if (state.pages.length === 0) {
        addPage();
    }

    attachEventListeners();
    updateUI();
    redraw();
}



function addPage() {
    const newPage = {
        strokes: [],
        texts: [],
        created: new Date().toISOString()
    };
    state.pages.push(newPage);
    state.pageIndex = state.pages.length - 1;
    saveToLocalStorage();
    updateUI();
    redraw();
}

function deletePage() {
    if (state.pages.length <= 1) return;
    if (confirm('Are you sure you want to delete this page?')) {
        state.pages.splice(state.pageIndex, 1);
        state.pageIndex = Math.max(0, state.pageIndex - 1);
        hideFloatingUI();
        saveToLocalStorage();
        updateUI();
        redraw();
    }
}

// --- Event Listeners ---

function attachEventListeners() {
    const canvas = state.canvas;

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    // Toolbar actions
    document.getElementById('btnPen').onclick = () => setTool('pen');
    document.getElementById('btnEraser').onclick = () => setTool('eraser');
    document.getElementById('btnSelect').onclick = () => setTool('select');
    document.getElementById('btnText').onclick = () => setTool('text');
    
    document.getElementById('btnUndo').onclick = undo;
    document.getElementById('btnRedo').onclick = redo;
    document.getElementById('btnOCR').onclick = () => runOCR();
    document.getElementById('btnClear').onclick = clearPage;

    document.getElementById('btnPrev').onclick = () => {
        if (state.pageIndex > 0) {
            if (state.textEditing) closeTextEditor();
            hideFloatingUI();
            state.pageIndex--;
            updateUI();
            redraw();
        }
    };
    document.getElementById('btnNext').onclick = () => {
        if (state.pageIndex < state.pages.length - 1) {
            if (state.textEditing) closeTextEditor();
            hideFloatingUI();
            state.pageIndex++;
            updateUI();
            redraw();
        }
    };
    document.getElementById('btnAddPage').onclick = () => {
        hideFloatingUI();
        addPage();
    };
    document.getElementById('btnDeletePage').onclick = deletePage;
    document.getElementById('btnOCR').onclick = runOCR;
    document.getElementById('btnDownload').onclick = () => {
        if (state.textEditing) closeTextEditor();
        downloadPDF();
    };
    document.getElementById('btnDownloadPPT').onclick = () => {
        if (state.textEditing) closeTextEditor();
        downloadPPT();
    };
    document.getElementById('btnClear').onclick = clearPage;
    
    document.getElementById('btnLayoutPDF').onclick = () => setLayoutMode('pdf');
    document.getElementById('btnLayoutPPT').onclick = () => setLayoutMode('ppt');

    // Formatting buttons
    document.getElementById('fmtBold').onclick = () => toggleFormat('bold');
    document.getElementById('fmtItalic').onclick = () => toggleFormat('italic');
    document.getElementById('fmtUnderline').onclick = () => toggleFormat('underline');
    document.getElementById('fmtBullet').onclick = () => toggleFormat('isBullet');
    document.getElementById('fmtAlignLeft').onclick = () => setAlignment('left');
    document.getElementById('fmtAlignCenter').onclick = () => setAlignment('center');
    document.getElementById('fmtAlignRight').onclick = () => setAlignment('right');
    document.getElementById('fmtEdit').onclick = () => {
        if (state.selectedText) openTextEditor(state.selectedText);
    };
    document.getElementById('fmtDelete').onclick = deleteSelectedText;

    document.getElementById('fmtFontFamily').onchange = (e) => setFontFamily(e.target.value);
    document.getElementById('fmtFontSize').onchange = (e) => setFontSize(parseInt(e.target.value));
    document.getElementById('fmtSizeUp').onclick = () => changeFontSize(2);
    document.getElementById('fmtSizeDown').onclick = () => changeFontSize(-2);
    document.getElementById('fmtIndentIncrease').onclick = () => changeIndent(20);
    document.getElementById('fmtIndentDecrease').onclick = () => changeIndent(-20);
    document.getElementById('fmtClear').onclick = clearFormatting;
    document.getElementById('fmtComment').onclick = () => alert('Comment feature coming soon!');

    document.getElementById('fmtColor').oninput = (e) => {
        setTextColor(e.target.value);
        document.getElementById('textColorIndicator').style.background = e.target.value;
    };
    document.getElementById('fmtColor').addEventListener('mousedown', () => {
        // Save selection before the color picker steals focus
        const sel = window.getSelection();
        state._savedSelRange = (sel && sel.rangeCount > 0) ? sel.getRangeAt(0).cloneRange() : null;
    });
    document.getElementById('fmtBgColor').oninput = (e) => {
        setTextBgColor(e.target.value);
        document.getElementById('bgColorIndicator').style.background = e.target.value;
    };
    document.getElementById('fmtBgColor').addEventListener('mousedown', () => {
        const sel = window.getSelection();
        state._savedSelRange = (sel && sel.rangeCount > 0) ? sel.getRangeAt(0).cloneRange() : null;
    });


    // Global Paste handler
    window.addEventListener('paste', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
        const text = e.clipboardData.getData('text');
        if (text) {
            const pos = state.lastPointerPt || { x: 100, y: 100 };
            const newTextObj = {
                text: wrapText(text, state.textSize, state.width - 40, pos.x),
                x: pos.x,
                y: pos.y,
                color: state.textColor,
                size: state.textSize,
                bold: false,
                italic: false,
                underline: false,
                align: 'left'
            };
            const page = state.pages[state.pageIndex];
            page.texts.push(newTextObj);
            state.selectedText = newTextObj;
            saveToLocalStorage();
            redraw();
        }
    });

    // Click outside to close editor (but not when clicking the format toolbar)
    window.addEventListener('mousedown', (e) => {
        if (state.textEditing &&
            !e.target.closest('#textEditorOverlay') &&
            !e.target.closest('#floatingFormatToolbar')) {
            closeTextEditor();
        }
    });

    window.addEventListener('resize', () => {
        if (state.textEditing) {
            openTextEditor(state.textEditing.obj);
        }
    });

    // Property inputs
    document.getElementById('penColor').oninput = (e) => state.penColor = e.target.value;
    document.getElementById('penSize').oninput = (e) => {
        state.penSize = parseFloat(e.target.value);
        document.getElementById('penSizeValue').innerText = state.penSize.toFixed(1);
    };
    document.getElementById('textColor').oninput = (e) => state.textColor = e.target.value;
    document.getElementById('textSize').oninput = (e) => {
        state.textSize = parseInt(e.target.value);
        document.getElementById('textSizeValue').innerText = state.textSize;
    };

    // Keyboard events for text tool
    document.addEventListener('keydown', onKeyDown);

    canvas.addEventListener('dblclick', (e) => {
        const pos = getPointerPos(e);
        const page = state.pages[state.pageIndex];
        const hit = page.texts.find(t => {
            const box = getTextBox(t);
            return pos.x >= box.x && pos.x <= box.x + box.w && pos.y >= box.y && pos.y <= box.y + box.h;
        });
        if (hit) {
            openTextEditor(hit, pos);
            return;
        }
        
        // If we didn't hit anything, but are in text tool mode, create new text
        if (state.tool === 'text') {
            const newTextObj = {
                text: "New Text",
                x: pos.x,
                y: pos.y,
                size: state.textSize,
                color: state.textColor,
                bold: false,
                italic: false,
                underline: false,
                align: 'left',
                fontFamily: DEFAULT_FONT_FAMILY
            };
            const page = state.pages[state.pageIndex];
            page.texts.push(newTextObj);
            state.selectedText = newTextObj;
            saveToLocalStorage();
            redraw();
            openTextEditor(newTextObj, pos);
        }
    });
    document.getElementById('inlineEditor').oninput = (e) => {
        if (state.textEditing) {
            state.textEditing.obj.richHtml = e.target.innerHTML;
            state.textEditing.obj.text = e.target.innerText;
            saveToLocalStorage();
            // Don't call redraw() here as it would flicker (drawText returns early)
        }
    };
}

function setPenColor(color) {
    state.penColor = color;
    document.getElementById('penColor').value = color;
}

function setTool(tool) {
    state.tool = tool;
    updateUI();
}

function setLayoutMode(mode) {
    if (state.layoutMode === mode) return;
    
    state.layoutMode = mode;
    
    const sheet = document.getElementById('a4Sheet');
    if (mode === 'ppt') {
        state.width = 960;
        state.height = 540;
        sheet.classList.add('layout-ppt');
    } else {
        state.width = 794;
        state.height = 1123;
        sheet.classList.remove('layout-ppt');
    }
    
    state.canvas.width = state.width;
    state.canvas.height = state.height;
    
    saveToLocalStorage();
    updateUI();
    redraw();
}

function getPointerPos(e) {
    const rect = state.canvas.getBoundingClientRect();
    const scaleX = state.width / rect.width;
    const scaleY = state.height / rect.height;
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
    };
}

// --- Drawing Logic ---

function onPointerDown(e) {
    if (state.ocrProcessing) return;
    const pos = getPointerPos(e);
    state.lastPointerPt = pos;

    // Check handles for active selection
    if (state.selectedText) {
        const handle = getHandleAtPos(pos, state.selectedText);
        if (handle) {
            const box = getTextBox(state.selectedText);
            let anchor = { x: box.x, y: box.y };
            if (handle.id === 'nw') anchor = { x: box.x + box.w, y: box.y + box.h };
            if (handle.id === 'ne') anchor = { x: box.x, y: box.y + box.h };
            if (handle.id === 'sw') anchor = { x: box.x + box.w, y: box.y };
            if (handle.id === 'se') anchor = { x: box.x, y: box.y };

            state.resizingText = {
                obj: state.selectedText,
                initialWidth: getTextBox(state.selectedText).w,
                initialPos: pos,
                handle: handle,
                anchor: anchor
            };
            state.drawing = true;
            state.canvas.setPointerCapture(e.pointerId);
            return;
        }
    }

    // Check for object hit
    const page = state.pages[state.pageIndex];
    const hit = page.texts.find(t => {
        const box = getTextBox(t);
        return pos.x >= box.x && pos.x <= box.x + box.w && pos.y >= box.y && pos.y <= box.y + box.h;
    });

    if (hit) {
        state.selectedText = hit;
        if (state.tool === 'text') {
            handleTextToolClick(pos);
            return;
        }
        state.draggingText = {
            obj: hit,
            offset: { x: pos.x - hit.x, y: pos.y - hit.y }
        };
        state.drawing = true;
        state.canvas.setPointerCapture(e.pointerId);
        redraw();
        return;
    } else {
        // Only clear if we aren't dragging a new text box or starting a lasso
        if (state.tool !== 'text' && state.tool !== 'select') {
            hideFloatingUI();
        } else if (!state.drawing) {
            hideFloatingUI();
        }
    }

    state.drawing = true;
    if (state.tool === 'text') {
        // Check for hit first (to edit)
        const hit = page.texts.find(t => {
            const box = getTextBox(t);
            return pos.x >= box.x && pos.x <= box.x + box.w && pos.y >= box.y && pos.y <= box.y + box.h;
        });
        
        if (hit) {
            openTextEditor(hit, pos);
            return;
        }

        // Otherwise, start dragging a new text box width
        state.drawing = true;
        state.selectionPath = [pos]; // Use selectionPath to draw the box
        state.canvas.setPointerCapture(e.pointerId);
        return;
    }

    if (state.tool === 'select') {
        state.selectionPath = [pos];
        state.hasSelection = true;
    } else {
        state.currentStroke = {
            tool: state.tool,
            color: state.tool === 'pen' ? state.penColor : '#ffffff',
            size: state.tool === 'pen' ? state.penSize : 20,
            points: [pos]
        };
    }
    
    state.canvas.setPointerCapture(e.pointerId);
}

function onPointerMove(e) {
    const pos = getPointerPos(e);

    // Dynamic cursor feedback
    if (!state.drawing && (state.tool === 'text' || state.tool === 'select')) {
        const page = state.pages[state.pageIndex];
        
        // Check handles for cursor
        if (state.selectedText && getHandleAtPos(pos, state.selectedText)) {
            state.canvas.style.cursor = 'nwse-resize';
        } else {
            const hit = page.texts.find(t => {
                const box = getTextBox(t);
                return pos.x >= box.x && pos.x <= box.x + box.w && pos.y >= box.y && pos.y <= box.y + box.h;
            });
            state.canvas.style.cursor = hit ? 'move' : 'crosshair';
        }
    }

    if (!state.drawing || state.ocrProcessing) return;

    if (state.resizingText) {
        const obj = state.resizingText.obj;
        const handle = state.resizingText.handle;
        const anchor = state.resizingText.anchor;
        
        let newWidth = 50;
        if (handle.id === 'nw' || handle.id === 'sw') {
            newWidth = Math.max(50, anchor.x - pos.x);
            obj.x = anchor.x - newWidth;
        } else {
            newWidth = Math.max(50, pos.x - anchor.x);
            obj.x = anchor.x;
        }
        obj.width = newWidth;
        
        // Dynamic Reflow: Re-wrap text based on new width
        const unwrapped = obj.text.replace(/\n/g, ' ');
        obj.text = wrapText(unwrapped, obj.size, obj.x + obj.width, obj.x);
        
        if (state.textEditing && state.textEditing.obj === obj) {
            const editor = document.getElementById('inlineEditor');
            const canvasRect = state.canvas.getBoundingClientRect();
            const scale = canvasRect.width / state.width;
            
            editor.style.width = (obj.width * scale) + 'px';
            editor.style.maxWidth = 'none';
            
            const overlay = document.getElementById('textEditorOverlay');
            overlay.style.left = (obj.x * scale) + 'px';
        }
    } else if (state.draggingText) {
        state.draggingText.obj.x = pos.x - state.draggingText.offset.x;
        state.draggingText.obj.y = pos.y - state.draggingText.offset.y;
    } else if (state.tool === 'text' && state.drawing) {
        state.selectionPath.push(pos);
    } else if (state.tool === 'select') {
        state.selectionPath.push(pos);
    } else if (state.currentStroke) {
        state.currentStroke.points.push(pos);
    }
    
    redraw();
}

function onPointerUp(e) {
    if (!state.drawing) return;
    state.drawing = false;
    
    if (state.resizingText) {
        state.resizingText = null;
        saveToLocalStorage();
    } else if (state.draggingText) {
        state.draggingText = null;
        saveToLocalStorage();
    } else if (state.tool === 'text' && state.selectionPath.length > 1) {
        // Create text object with width from selection
        const start = state.selectionPath[0];
        const end = state.selectionPath[state.selectionPath.length - 1];
        const width = Math.max(50, Math.abs(end.x - start.x));
        const newTextObj = {
            text: "Type here...",
            x: Math.min(start.x, end.x),
            y: Math.min(start.y, end.y),
            color: state.textColor,
            size: state.textSize,
            bold: false,
            italic: false,
            underline: false,
            align: 'left',
            width: width 
        };
        const page = state.pages[state.pageIndex];
        page.texts.push(newTextObj);
        state.selectionPath = [];
        saveToLocalStorage();
        openTextEditor(newTextObj);
    } else if (state.tool === 'text') {
        // Simple click creation
        const pos = getPointerPos(e);
        handleTextToolClick(state.selectionPath[0] || pos);
        state.selectionPath = [];
    } else if (state.currentStroke) {
        if (state.currentStroke.points.length > 1) {
            pushHistory({
                type: 'stroke',
                pageIndex: state.pageIndex,
                stroke: state.currentStroke
            });
            state.pages[state.pageIndex].strokes.push(state.currentStroke);
            saveToLocalStorage();
        }
        state.currentStroke = null;
    }
    
    redraw();
    state.canvas.releasePointerCapture(e.pointerId);
}

function redraw() {
    const ctx = state.ctx;
    ctx.clearRect(0, 0, state.width, state.height);
    
    const page = state.pages[state.pageIndex];
    if (!page) return;
    // Background
    if (page.background) {
        if (!page._bgImg) {
            page._bgImg = new Image();
            page._bgImg.onload = () => redraw();
            page._bgImg.src = page.background;
        }
        if (page._bgImg.complete) {
            ctx.drawImage(page._bgImg, 0, 0);
        } else {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, state.width, state.height);
        }
    } else {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, state.width, state.height);
    }

    // Draw saved strokes
    page.strokes.forEach(drawStroke);

    // Draw current stroke
    if (state.currentStroke) drawStroke(state.currentStroke);

    // Draw text objects
    page.texts.forEach(drawText);

    // Draw selection lasso (strokes)
    if (state.tool === 'select' && state.selectionPath.length > 1) {
        drawSelectionLasso();
    }

    // Draw persistent text selection box
    if (state.selectedText && (!state.textEditing || state.textEditing.obj !== state.selectedText)) {
        drawTextSelectionBox(state.selectedText);
        updateFormatToolbar(state.selectedText);
    } else if (!state.textEditing) {
        document.getElementById('floatingFormatToolbar').style.display = 'none';
    }
}

function drawStroke(stroke) {
    const ctx = state.ctx;
    if (stroke.points.length < 2) return;

    ctx.beginPath();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
}

/**
 * Converts an innerHTML string into a flat array of styled text segments
 * for canvas rendering. Each segment carries its own style properties.
 * @param {string} html - The innerHTML to parse
 * @param {object} base - Base style from the text object
 * @returns {Array<{text:string, bold:boolean, italic:boolean, underline:boolean, color:string, bgColor:string, size:number}>}
 */
function parseHtmlToSegments(html, base) {
    const container = document.createElement('div');
    container.innerHTML = html;
    const segments = [];

    function resolveColor(cssColor) {
        if (!cssColor || cssColor === 'inherit') return null;
        // execCommand sometimes returns rgb(...), convert to hex
        const m = cssColor.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
        if (m) {
            return '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
        }
        return cssColor;
    }

    function walk(node, style) {
        if (node.nodeType === Node.TEXT_NODE) {
            const txt = node.textContent;
            if (txt) {
                // Split on newlines within the text node itself
                const parts = txt.split('\n');
                parts.forEach((part, i) => {
                    if (i > 0) segments.push({ ...style, text: '\n', isNewline: true });
                    if (part) segments.push({ ...style, text: part });
                });
            }
            return;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) return;

        const tag = node.nodeName.toUpperCase();

        // Block-level elements produce a newline before their content (except first)
        const isBlock = ['DIV', 'P', 'LI', 'UL', 'OL', 'BLOCKQUOTE'].includes(tag);
        if (isBlock && segments.length > 0 && !segments[segments.length - 1].isNewline) {
            segments.push({ ...style, text: '\n', isNewline: true });
        }

        if (tag === 'BR') {
            segments.push({ ...style, text: '\n', isNewline: true });
            return;
        }

        // Inherit style and augment based on element tag/inline style
        const s = { ...style };
        if (tag === 'B' || tag === 'STRONG') s.bold = true;
        if (tag === 'I' || tag === 'EM')     s.italic = true;
        if (tag === 'U')                     s.underline = true;

        if (node.style) {
            const fw = node.style.fontWeight;
            if (fw === 'bold' || fw === '700' || parseInt(fw) >= 700) s.bold = true;
            if (node.style.fontStyle === 'italic')   s.italic = true;
            if ((node.style.textDecoration || '').includes('underline')) s.underline = true;
            const col = resolveColor(node.style.color);
            if (col) s.color = col;
            const bg = resolveColor(node.style.backgroundColor);
            if (bg && bg !== 'transparent') s.bgColor = bg;
            if (node.style.fontSize) {
                // fontSize in editor is scaled by canvasScale, store in canvas pixels
                const canvasScale = state.canvas.getBoundingClientRect().width / state.width;
                const editorPx = parseFloat(node.style.fontSize);
                if (!isNaN(editorPx) && canvasScale > 0) {
                    s.size = editorPx / canvasScale;
                }
            }
        }

        node.childNodes.forEach(child => walk(child, s));

        // After block element: newline
        if (isBlock && segments.length > 0 && !segments[segments.length - 1].isNewline) {
            segments.push({ ...style, text: '\n', isNewline: true });
        }
    }

    walk(container, base);

    // Remove trailing newline segments
    while (segments.length > 0 && segments[segments.length - 1].isNewline) {
        segments.pop();
    }

    return segments;
}

/**
 * Renders a text object that has richHtml on the canvas,
 * drawing each formatted segment independently.
 */
function drawTextRich(textObj) {
    const ctx = state.ctx;

    const base = {
        bold:      textObj.bold      || false,
        italic:    textObj.italic    || false,
        underline: textObj.underline || false,
        color:     textObj.color     || '#000000',
        bgColor:   null,
        size:      textObj.size      || 18,
        fontFamily: textObj.fontFamily || 'Inter, sans-serif'
    };

    const segments = parseHtmlToSegments(textObj.richHtml, base);

    // Split segments into lines on newline markers
    const lines = [[]];
    segments.forEach(seg => {
        if (seg.isNewline) {
            lines.push([]);
        } else {
            lines[lines.length - 1].push(seg);
        }
    });

    const lineHeight = textObj.size * 1.2;
    const customIndent = textObj.indent || 0;

    ctx.save();
    ctx.textBaseline = 'top';

    lines.forEach((segs, lineIdx) => {
        const y = textObj.y + lineIdx * lineHeight;
        let x = textObj.x + customIndent;

        segs.forEach(seg => {
            const segSize = seg.size || textObj.size;
            const fontParts = [];
            if (seg.italic) fontParts.push('italic');
            if (seg.bold)   fontParts.push('bold');
            fontParts.push(`${segSize}px`);
            fontParts.push(textObj.fontFamily || 'Inter, sans-serif');
            ctx.font = fontParts.join(' ');

            const w = ctx.measureText(seg.text).width;

            // Draw background highlight
            if (seg.bgColor && seg.bgColor !== 'transparent') {
                ctx.fillStyle = seg.bgColor;
                ctx.fillRect(x, y, w, segSize * 1.2);
            }

            // Draw text
            ctx.fillStyle = seg.color || textObj.color || '#000000';
            ctx.fillText(seg.text, x, y);

            // Draw underline
            if (seg.underline) {
                ctx.beginPath();
                ctx.strokeStyle = seg.color || textObj.color || '#000000';
                ctx.lineWidth = Math.max(1, segSize / 15);
                ctx.moveTo(x, y + segSize + 1);
                ctx.lineTo(x + w, y + segSize + 1);
                ctx.stroke();
            }

            x += w;
        });
    });

    ctx.restore();
}

function drawText(textObj) {
    const ctx = state.ctx;
    
    // Don't draw text if it's currently being edited inline
    if (state.textEditing && state.textEditing.obj === textObj) return;

    // Route to rich renderer if richHtml is stored
    if (textObj.richHtml) {
        drawTextRich(textObj);
        return;
    }

    ctx.save();
    
    // Draw background if enabled
    if (textObj.bgColor && textObj.bgColor !== 'transparent') {
        const box = getTextBox(textObj);
        ctx.fillStyle = textObj.bgColor;
        ctx.fillRect(box.x - 4, box.y - 4, box.w + 8, box.h + 8);
    }

    ctx.fillStyle = textObj.color || '#000000';
    
    let fontParts = [];
    if (textObj.italic) fontParts.push('italic');
    if (textObj.bold) fontParts.push('bold');
    fontParts.push(`${textObj.size}px`);
    fontParts.push(textObj.fontFamily || 'Inter, sans-serif');
    
    ctx.font = fontParts.join(' ');
    ctx.textBaseline = 'top';
    ctx.textAlign = textObj.align || 'left';
    
    const lines = textObj.text.split('\n');
    const lineHeight = textObj.size * 1.2;
    const bulletIndent = textObj.isBullet ? textObj.size * 1.5 : 0;
    const customIndent = textObj.indent || 0;
    const hasFixedWidth = typeof textObj.width === 'number' && textObj.width > 0;
    const anchorBaseX = hasFixedWidth
        ? textObj.x + (textObj.align === 'center' ? textObj.width / 2 : textObj.align === 'right' ? textObj.width : 0)
        : textObj.x;
    
    lines.forEach((line, i) => {
        const y = textObj.y + (i * lineHeight);
        const x = anchorBaseX + bulletIndent + customIndent;

        // Draw Bullet
        if (textObj.isBullet) {
            ctx.beginPath();
            const bulletSize = textObj.size / 4;
            const bulletX = textObj.x + (textObj.size / 2);
            const bulletY = y + (textObj.size / 2);
            ctx.arc(bulletX, bulletY, bulletSize, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.fillText(line, x, y);
        
        if (textObj.underline) {
            const metrics = ctx.measureText(line);
            ctx.beginPath();
            ctx.lineWidth = Math.max(1, textObj.size / 15);
            let startX = x;
            if (ctx.textAlign === 'center') startX = x - (metrics.width / 2);
            else if (ctx.textAlign === 'right') startX = x - metrics.width;
            
            ctx.moveTo(startX, y + textObj.size);
            ctx.lineTo(startX + metrics.width, y + textObj.size);
            ctx.stroke();
        }
    });
    ctx.restore();
}


function drawSelectionLasso() {
    const ctx = state.ctx;
    ctx.save();
    ctx.strokeStyle = '#0d6efd';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(state.selectionPath[0].x, state.selectionPath[0].y);
    state.selectionPath.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.stroke();
    ctx.restore();
}

function drawTextSelectionBox(textObj) {
    const ctx = state.ctx;
    ctx.save();
    
    const box = getTextBox(textObj);
    const { x: startX, y, w, h } = box;

    // Outer Glow/Border
    ctx.strokeStyle = 'rgba(0, 122, 255, 0.2)'; 
    ctx.lineWidth = 1;
    ctx.setLineDash([8, 4]); 
    ctx.strokeRect(startX - 10, y - 10, w + 20, h + 20);
    
    // Draw rounded handles
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#007aff';
    ctx.lineWidth = 1.5;
    
    const handleSize = 8;
    const handlePositions = [
        { x: startX - 10, y: y - 10 },
        { x: startX + w + 10, y: y - 10 },
        { x: startX - 10, y: y + h + 10 },
        { x: startX + w + 10, y: y + h + 10 }
    ];
    
    handlePositions.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, handleSize / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    });
    
    ctx.restore();
}

function getTextBox(textObj) {
    state.ctx.font = `${textObj.size}px ${textObj.fontFamily || DEFAULT_FONT_FAMILY}`;
    const lines = textObj.text.split('\n');
    const bulletIndent = textObj.isBullet ? textObj.size * 1.5 : 0;
    
    let maxW = 0;
    if (textObj.width) {
        maxW = textObj.width;
    } else {
        lines.forEach(line => {
            maxW = Math.max(maxW, state.ctx.measureText(line).width);
        });
        maxW += bulletIndent;
    }
    
    const w = maxW;
    const h = lines.length * textObj.size * 1.2;
    
    let x = textObj.x;
    if (!textObj.width) {
        if (textObj.align === 'center') x = textObj.x - (w / 2);
        else if (textObj.align === 'right') x = textObj.x - w;
    }

    return { x, y: textObj.y, w, h };
}

function getHandleAtPos(pos, textObj) {
    const box = getTextBox(textObj);
    const { x: startX, y, w, h } = box;

    const handles = [
        { x: startX - 10, y: y - 10, id: 'nw' },
        { x: startX + w + 10, y: y - 10, id: 'ne' },
        { x: startX - 10, y: y + h + 10, id: 'sw' },
        { x: startX + w + 10, y: y + h + 10, id: 'se' }
    ];

    // Responsive hit area
    return handles.find(h => {
        const dist = Math.sqrt(Math.pow(pos.x - h.x, 2) + Math.pow(pos.y - h.y, 2));
        return dist <= 15;
    });
}

// --- Text Tool Logic ---

function handleTextToolClick(pos) {
    const page = state.pages[state.pageIndex];
    const hit = page.texts.find(t => {
        const box = getTextBox(t);
        return pos.x >= box.x && pos.x <= box.x + box.w && pos.y >= box.y && pos.y <= box.y + box.h;
    });

    if (hit) {
        openTextEditor(hit, pos);
    } else {
        const newTextObj = {
            text: "Type here...",
            x: pos.x,
            y: pos.y,
            color: state.textColor,
            size: state.textSize,
            bold: false,
            italic: false,
            underline: false,
            align: 'left'
        };
        page.texts.push(newTextObj);
        pushHistory({ type: 'text_add', pageIndex: state.pageIndex, obj: newTextObj });
        saveToLocalStorage();
        redraw();
        openTextEditor(newTextObj, pos);
    }
}

function openTextEditor(textObj, clickPos = null) {
    if (state.textEditing) closeTextEditor();
    
    state.textEditing = { obj: textObj };
    const overlay = document.getElementById('textEditorOverlay');
    const editor = document.getElementById('inlineEditor');
    
    // Position the editor overlay
    const canvasRect = state.canvas.getBoundingClientRect();
    const scale = canvasRect.width / state.width;
    
    const box = getTextBox(textObj);
    overlay.style.left = (box.x * scale) + 'px';
    overlay.style.top = (textObj.y * scale) + 'px';
    overlay.style.display = 'block';
    
    // Load rich HTML if available, otherwise use plain text
    if (textObj.richHtml) {
        editor.innerHTML = textObj.richHtml;
    } else {
        editor.innerText = textObj.text;
    }
    editor.style.fontSize = (textObj.size * scale) + 'px';
    editor.style.color = textObj.color || '#000000';
    // Base styles — per-word formatting is inside the innerHTML spans
    editor.style.fontWeight = 'normal';
    editor.style.fontStyle = 'normal';
    editor.style.textDecoration = 'none';
    editor.style.textAlign = textObj.align || 'left';
    editor.style.width = textObj.width ? (textObj.width * scale) + 'px' : 'auto';
    editor.style.maxWidth = ((getTextRightBoundary(textObj) - box.x) * scale) + 'px';
    
    // Show the format toolbar immediately when editor opens
    updateFormatToolbar(textObj);
    
    // Wire up selectionchange so toolbar always reflects cursor/selection state
    state._selectionChangeHandler = () => syncToolbarToSelection();
    document.addEventListener('selectionchange', state._selectionChangeHandler);
    
    redraw(); // Redraw will hide the text on canvas
    
    // Focus the editor immediately
    setTimeout(() => {
        editor.focus();
        
        if (clickPos) {
            // Place cursor at click position
            const screenX = (clickPos.x * scale) + canvasRect.left;
            const screenY = (clickPos.y * scale) + canvasRect.top;
            
            let range;
            if (document.caretRangeFromPoint) {
                range = document.caretRangeFromPoint(screenX, screenY);
            } else if (document.caretPositionFromPoint) {
                const pos = document.caretPositionFromPoint(screenX, screenY);
                if (pos) {
                    range = document.createRange();
                    range.setStart(pos.offsetNode, pos.offset);
                    range.setEnd(pos.offsetNode, pos.offset);
                }
            }
            
            if (range) {
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
            } else {
                // Fallback: select all if we couldn't find precise spot
                const range = document.createRange();
                range.selectNodeContents(editor);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
            }
        } else {
            // Select all text if no click pos (e.g. from new text)
            const range = document.createRange();
            range.selectNodeContents(editor);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
        }
    }, 10);
}

function closeTextEditor() {
    if (!state.textEditing) return;
    
    // Remove the selection-sync listener
    if (state._selectionChangeHandler) {
        document.removeEventListener('selectionchange', state._selectionChangeHandler);
        state._selectionChangeHandler = null;
    }
    
    const editor = document.getElementById('inlineEditor');
    const obj = state.textEditing.obj;
    
    // Save both rich HTML and plain text
    obj.richHtml = editor.innerHTML;
    obj.text = editor.innerText;
    
    state.textEditing = null;
    document.getElementById('textEditorOverlay').style.display = 'none';
    
    saveToLocalStorage();
    redraw();
    
    // Reselect it so the toolbar stays
    state.selectedText = obj;
    redraw();
}

function toggleFormat(type) {
    const editor = document.getElementById('inlineEditor');
    
    if (state.textEditing) {
        // Clicking a toolbar button can steal focus and collapse the selection.
        // Save the selection range first, then restore it before execCommand.
        const savedSel = window.getSelection();
        let savedRange = null;
        if (savedSel && savedSel.rangeCount > 0) {
            savedRange = savedSel.getRangeAt(0).cloneRange();
        }
        
        editor.focus();
        
        // Restore the selection if it was lost
        if (savedRange) {
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(savedRange);
        }
        
        if (type === 'bold')      document.execCommand('bold',      false, null);
        if (type === 'italic')    document.execCommand('italic',    false, null);
        if (type === 'underline') document.execCommand('underline', false, null);
        if (type === 'isBullet') {
            document.execCommand('insertUnorderedList', false, null);
        }
        // Save rich HTML immediately and sync toolbar to new state
        state.textEditing.obj.richHtml = editor.innerHTML;
        state.textEditing.obj.text     = editor.innerText;
        saveToLocalStorage();
        syncToolbarToSelection();
        return;
    }
    
    // No editor open — apply to whole object
    const obj = state.selectedText;
    if (!obj) return;
    obj[type] = !obj[type];
    // Also update richHtml if present so re-opening the editor reflects the change
    if (obj.richHtml) {
        obj.richHtml = null; // reset so openTextEditor re-generates from plain text
    }
    updateFormatToolbar(obj);
    saveToLocalStorage();
    redraw();
}

function setAlignment(align) {
    const obj = state.textEditing ? state.textEditing.obj : state.selectedText;
    if (!obj) return;
    
    obj.align = align;
    const pageMargin = 40;

    if (typeof obj.width === 'number' && obj.width > 0) {
        if (align === 'left') obj.x = pageMargin;
        else if (align === 'center') obj.x = (state.width - obj.width) / 2;
        else if (align === 'right') obj.x = state.width - pageMargin - obj.width;
    } else {
        if (align === 'left') obj.x = pageMargin;
        else if (align === 'center') obj.x = state.width / 2;
        else if (align === 'right') obj.x = state.width - pageMargin;
    }
    
    if (state.textEditing) {
        const editor = document.getElementById('inlineEditor');
        editor.style.textAlign = align;
        const canvasRect = state.canvas.getBoundingClientRect();
        const scale = canvasRect.width / state.width;
        const newBox = getTextBox(obj);
        const overlay = document.getElementById('textEditorOverlay');
        overlay.style.left = (newBox.x * scale) + 'px';
    }
    
    updateFormatToolbar(obj);
    saveToLocalStorage();
    redraw();
}

function setTextColor(color) {
    const obj = state.textEditing ? state.textEditing.obj : state.selectedText;
    if (!obj) return;
    
    obj.color = color;
    
    if (state.textEditing) {
        const editor = document.getElementById('inlineEditor');
        // Restore saved selection before applying color
        if (state._savedSelRange) {
            editor.focus();
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(state._savedSelRange);
        }
        const sel = window.getSelection();
        const hasSelection = sel && sel.rangeCount > 0 && !sel.isCollapsed;
        if (hasSelection) {
            document.execCommand('foreColor', false, color);
            obj.richHtml = editor.innerHTML;
            obj.text     = editor.innerText;
        } else {
            editor.style.color = color;
        }
        saveToLocalStorage();
        return;
    }
    
    saveToLocalStorage();
    redraw();
}

function setTextBgColor(color) {
    const obj = state.textEditing ? state.textEditing.obj : state.selectedText;
    if (!obj) return;
    
    obj.bgColor = color;
    
    if (state.textEditing) {
        const editor = document.getElementById('inlineEditor');
        // Restore saved selection before applying highlight
        if (state._savedSelRange) {
            editor.focus();
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(state._savedSelRange);
        }
        const sel = window.getSelection();
        const hasSelection = sel && sel.rangeCount > 0 && !sel.isCollapsed;
        if (hasSelection) {
            document.execCommand('hiliteColor', false, color);
            obj.richHtml = editor.innerHTML;
            obj.text     = editor.innerText;
        } else {
            editor.style.backgroundColor = color;
        }
        saveToLocalStorage();
        return;
    }
    
    saveToLocalStorage();
    redraw();
}


/**
 * Syncs the floating format toolbar to the current browser selection.
 * Called on every selectionchange event while the editor is open.
 * This gives the exact PPT experience: toolbar buttons reflect the
 * formatting AT the cursor, not just the whole text object.
 */
function syncToolbarToSelection() {
    if (!state.textEditing) return;
    
    const toolbar = document.getElementById('floatingFormatToolbar');
    toolbar.style.display = 'flex';
    
    // Always save the current selection so color pickers etc. can restore it
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
        state._savedSelRange = selection.getRangeAt(0).cloneRange();
    }
    
    // --- Button states from live selection ---
    const isBold      = document.queryCommandState('bold');
    const isItalic    = document.queryCommandState('italic');
    const isUnderline = document.queryCommandState('underline');

    
    document.getElementById('fmtBold').classList.toggle('active', isBold);
    document.getElementById('fmtItalic').classList.toggle('active', isItalic);
    document.getElementById('fmtUnderline').classList.toggle('active', isUnderline);
    
    // --- Font family from selection ---
    const fontName = document.queryCommandValue('fontName');
    if (fontName) {
        const cleaned = fontName.replace(/[\'"]/g, '').split(',')[0].trim();
        const sel = document.getElementById('fmtFontFamily');
        for (const opt of sel.options) {
            if (opt.value.toLowerCase() === cleaned.toLowerCase()) {
                sel.value = opt.value;
                break;
            }
        }
    }
    
    // --- Font size from selection (via computed style of the focused node) ---
    // Reuse the 'selection' variable already captured above

    if (selection && selection.rangeCount > 0) {
        let node = selection.getRangeAt(0).startContainer;
        if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
        if (node && node.closest('#inlineEditor')) {
            const computed = window.getComputedStyle(node);
            const pxSize = parseFloat(computed.fontSize);
            if (!isNaN(pxSize)) {
                const canvasScale = state.canvas.getBoundingClientRect().width / state.width;
                const canvasPx = Math.round(pxSize / canvasScale);
                // Find closest option
                const sizeSelect = document.getElementById('fmtFontSize');
                let closest = sizeSelect.options[0];
                let closestDiff = Infinity;
                for (const opt of sizeSelect.options) {
                    const diff = Math.abs(parseInt(opt.value) - canvasPx);
                    if (diff < closestDiff) { closestDiff = diff; closest = opt; }
                }
                sizeSelect.value = closest.value;
            }
            
            // Color indicator
            const col = computed.color;
            if (col) {
                const hex = rgbToHex(col);
                if (hex) {
                    document.getElementById('fmtColor').value = hex;
                    document.getElementById('textColorIndicator').style.background = hex;
                }
            }
        }
    }
    
    // --- Position toolbar near selection ---
    positionToolbarNearSelection();
}

/**
 * Converts an rgb(r,g,b) string to #rrggbb hex.
 */
function rgbToHex(rgb) {
    const m = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (!m) return null;
    return '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
}

/**
 * Positions the floating toolbar near the current text selection,
 * exactly like PowerPoint's mini toolbar.
 */
function positionToolbarNearSelection() {
    const toolbar = document.getElementById('floatingFormatToolbar');
    const sel = window.getSelection();
    
    let refRect = null;
    
    if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const rects = range.getClientRects();
        if (rects.length > 0) {
            refRect = rects[0];
        } else {
            refRect = range.getBoundingClientRect();
        }
    }
    
    if (!refRect || (refRect.width === 0 && refRect.height === 0)) {
        // No visible selection — position relative to the text object box
        if (state.textEditing) {
            const obj = state.textEditing.obj;
            const canvasRect = state.canvas.getBoundingClientRect();
            const scale = canvasRect.width / state.width;
            const box = getTextBox(obj);
            refRect = {
                left:   canvasRect.left + box.x * scale,
                top:    canvasRect.top  + box.y * scale,
                width:  box.w * scale,
                height: 0,
                right:  canvasRect.left + (box.x + box.w) * scale,
                bottom: canvasRect.top  + box.y * scale
            };
        } else {
            return;
        }
    }
    
    const toolbarW = toolbar.offsetWidth  || 400;
    const toolbarH = toolbar.offsetHeight || 90;
    const gap = 10;
    const margin = 8;
    
    // Center above the selection
    let tx = refRect.left + refRect.width / 2 - toolbarW / 2;
    let ty = refRect.top - toolbarH - gap;
    
    // Clamp horizontally
    if (tx < margin) tx = margin;
    if (tx + toolbarW > window.innerWidth - margin) tx = window.innerWidth - toolbarW - margin;
    
    // If too close to top, flip below
    if (ty < margin) {
        ty = refRect.bottom + gap;
        toolbar.classList.add('pos-bottom');
    } else {
        toolbar.classList.remove('pos-bottom');
    }
    
    toolbar.style.left = tx + 'px';
    toolbar.style.top  = ty + 'px';
}

function updateFormatToolbar(obj) {
    const toolbar = document.getElementById('floatingFormatToolbar');
    if (!obj) {
        toolbar.style.display = 'none';
        return;
    }
    toolbar.style.display = 'flex';
    
    // If editor is open, defer to the live selection sync
    if (state.textEditing && state.textEditing.obj === obj) {
        syncToolbarToSelection();
        return;
    }
    
    // No editor open: position relative to text box on canvas
    const canvasRect = state.canvas.getBoundingClientRect();
    const scale = canvasRect.width / state.width;
    const box = getTextBox(obj);
    
    const toolbarW = toolbar.offsetWidth  || 400;
    const toolbarH = toolbar.offsetHeight || 90;
    
    let tx = canvasRect.left + (box.x + box.w / 2) * scale - toolbarW / 2;
    let ty = canvasRect.top  + box.y * scale - toolbarH - 10;
    
    if (tx < 8) tx = 8;
    if (tx + toolbarW > window.innerWidth - 8) tx = window.innerWidth - toolbarW - 8;
    
    if (ty < 8) {
        ty = canvasRect.top + (box.y + box.h) * scale + 10;
        toolbar.classList.add('pos-bottom');
    } else {
        toolbar.classList.remove('pos-bottom');
    }
    
    toolbar.style.left = tx + 'px';
    toolbar.style.top  = ty + 'px';

    // Reflect object-level formatting on buttons
    document.getElementById('fmtBold').classList.toggle('active', !!obj.bold);
    document.getElementById('fmtItalic').classList.toggle('active', !!obj.italic);
    document.getElementById('fmtUnderline').classList.toggle('active', !!obj.underline);
    document.getElementById('fmtBullet').classList.toggle('active', !!obj.isBullet);
    
    document.getElementById('fmtAlignLeft').classList.toggle('active', obj.align === 'left' || !obj.align);
    document.getElementById('fmtAlignCenter').classList.toggle('active', obj.align === 'center');
    document.getElementById('fmtAlignRight').classList.toggle('active', obj.align === 'right');

    document.getElementById('fmtFontFamily').value = obj.fontFamily || 'Inter';
    document.getElementById('fmtFontSize').value   = obj.size || '18';

    document.getElementById('fmtColor').value  = obj.color   || '#000000';
    document.getElementById('fmtBgColor').value = obj.bgColor || '#ffffff';
    document.getElementById('textColorIndicator').style.background = obj.color   || '#000000';
    document.getElementById('bgColorIndicator').style.background   = obj.bgColor || '#ffffff';
}

function setFontFamily(font) {
    const obj = state.textEditing ? state.textEditing.obj : state.selectedText;
    if (!obj) return;
    obj.fontFamily = font;
    if (state.textEditing) {
        document.getElementById('inlineEditor').style.fontFamily = font;
    }
    saveToLocalStorage();
    redraw();
}

function setFontSize(size) {
    const obj = state.textEditing ? state.textEditing.obj : state.selectedText;
    if (!obj) return;
    obj.size = size;
    if (state.textEditing) {
        const editor = document.getElementById('inlineEditor');
        const sel = window.getSelection();
        const hasSelection = sel && sel.rangeCount > 0 && !sel.isCollapsed;
        if (hasSelection) {
            // Wrap selection in a span with the new font size
            const canvasScale = state.canvas.getBoundingClientRect().width / state.width;
            editor.focus();
            document.execCommand('fontSize', false, '7'); // placeholder size
            // Replace the font element with a span (execCommand uses <font> tag)
            editor.querySelectorAll('font[size="7"]').forEach(el => {
                const span = document.createElement('span');
                span.style.fontSize = (size * canvasScale) + 'px';
                span.innerHTML = el.innerHTML;
                el.replaceWith(span);
            });
            obj.richHtml = editor.innerHTML;
            obj.text     = editor.innerText;
        } else {
            const canvasScale = state.canvas.getBoundingClientRect().width / state.width;
            editor.style.fontSize = (size * canvasScale) + 'px';
        }
    }
    saveToLocalStorage();
    redraw();
}

function changeFontSize(delta) {
    const obj = state.textEditing ? state.textEditing.obj : state.selectedText;
    if (!obj) return;
    const newSize = Math.max(8, (obj.size || 18) + delta);
    document.getElementById('fmtFontSize').value = newSize;
    setFontSize(newSize);
}

function changeIndent(delta) {
    const obj = state.textEditing ? state.textEditing.obj : state.selectedText;
    if (!obj) return;
    obj.indent = Math.max(0, (obj.indent || 0) + delta);
    saveToLocalStorage();
    redraw();
}

function clearFormatting() {
    const obj = state.textEditing ? state.textEditing.obj : state.selectedText;
    if (!obj) return;
    obj.bold = false;
    obj.italic = false;
    obj.underline = false;
    obj.color = '#000000';
    obj.bgColor = 'transparent';
    obj.size = 18;
    obj.fontFamily = 'Inter';
    obj.indent = 0;
    obj.richHtml = null; // Reset rich formatting — plain text will be used
    
    if (state.textEditing) {
        const ed = document.getElementById('inlineEditor');
        // Strip all HTML tags, keep plain text
        const plain = ed.innerText;
        ed.innerText = plain;
        obj.text = plain;
        ed.style.fontWeight = 'normal';
        ed.style.fontStyle = 'normal';
        ed.style.textDecoration = 'none';
        ed.style.color = '#000';
        ed.style.backgroundColor = 'transparent';
        ed.style.fontSize = (18 * (state.canvas.getBoundingClientRect().width / state.width)) + 'px';
        ed.style.fontFamily = 'Inter';
    }
    
    updateFormatToolbar(obj);
    saveToLocalStorage();
    redraw();
}

// --- OCR Logic ---

async function runOCR() {
    const page = state.pages[state.pageIndex];
    if (!page || page.strokes.length === 0 || state.ocrProcessing) return;

    state.ocrProcessing = true;
    document.getElementById('ocrOverlay').style.display = 'flex';
    document.getElementById('ocrStatus').innerText = 'Analyzing Handwriting...';

    try {
        const langCode = document.getElementById('ocrLanguage').value;
        
        // Prepare strokes for Google Input Tools API
        let strokesToProcess = page.strokes.filter(s => s.tool === 'pen');
        
        // Filter by selection if active
        if (state.hasSelection && state.selectionPath.length > 3) {
            strokesToProcess = strokesToProcess.filter(s => {
                // If any point of the stroke is inside the selection, include it
                return s.points.some(p => isPointInPolygon(p, state.selectionPath));
            });
        }

        const strokesData = strokesToProcess.map(s => [
            s.points.map(p => Math.round(p.x)),
            s.points.map(p => Math.round(p.y)),
            s.points.map((p, i) => i * 10)
        ]);

        if (strokesData.length === 0) {
            throw new Error(state.hasSelection ? 'No handwriting found in selected area' : 'No handwriting to recognize');
        }

        // Tier 1: Google Input Tools
        const url = `https://www.google.com/inputtools/request?ime=handwriting&app=autofill&cs=1&oe=UTF-8&languages=${langCode}`;
        const body = {
            input_type: 0,
            requests: [{
                writing_guide: { width: state.width, height: state.height },
                ink: strokesData,
                language: langCode
            }]
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const data = await response.json();
        if (data && data[0] === "SUCCESS") {
            const candidates = data[1][0][1];
            if (candidates && candidates.length > 0) {
                applyOCRResult(candidates[0], strokesToProcess);
                return;
            }
        }

        // Tier 2: Fallback to Tesseract.js
        document.getElementById('ocrStatus').innerText = 'Using fallback OCR...';
        
        // For fallback, we might want to crop the canvas to selection if active
        // But for simplicity, we'll use the whole canvas for now (Tesseract is less precise anyway)
        const dataUrl = state.canvas.toDataURL();
        const tesseractLang = langCode === 'ml' ? 'mal' : 'eng';
        const result = await Tesseract.recognize(dataUrl, tesseractLang);
        if (result.data.text.trim()) {
            applyOCRResult(result.data.text.trim(), strokesToProcess);
        } else {
            alert('Could not recognize any text.');
        }

    } catch (err) {
        console.error('OCR Error:', err);
        alert('OCR failed: ' + err.message);
    } finally {
        state.ocrProcessing = false;
        document.getElementById('ocrOverlay').style.display = 'none';
    }
}

function applyOCRResult(text, removedStrokes = null) {
    const page = state.pages[state.pageIndex];
    const shouldAppend = document.getElementById('chkAppendOCR').checked;
    
    // If not provided, remove all pen strokes (legacy behavior)
    if (!removedStrokes) removedStrokes = page.strokes.filter(s => s.tool === 'pen');
    
    let lastTextBefore = null;
    let newTextObj = null;

    if (shouldAppend && page.texts.length > 0) {
        const lastText = page.texts[page.texts.length - 1];
        lastTextBefore = lastText.text;
        
        // Append with space
        let combined = lastText.text + " " + text;
        lastText.text = wrapText(combined, lastText.size, getTextRightBoundary(lastText), lastText.x); 
    } else {
        let minX = state.width, minY = state.height;
        let found = false;
        removedStrokes.forEach(s => {
            s.points.forEach(p => {
                minX = Math.min(minX, p.x);
                minY = Math.min(minY, p.y);
                found = true;
            });
        });

        if (!found) { minX = 100; minY = 100; }

        newTextObj = {
            text: wrapText(text, state.textSize, state.width - 40, minX),
            x: minX,
            y: minY,
            color: state.textColor,
            size: state.textSize,
            bold: false,
            italic: false,
            underline: false,
            align: 'left'
        };
        page.texts.push(newTextObj);
    }

    // Push OCR action to history
    pushHistory({
        type: 'ocr',
        pageIndex: state.pageIndex,
        newTextObj: newTextObj,
        lastTextObj: (shouldAppend && page.texts.length > 0) ? page.texts[page.texts.length - 1] : null,
        lastTextOldValue: lastTextBefore,
        lastTextNewValue: (shouldAppend && page.texts.length > 0) ? page.texts[page.texts.length - 1].text : null,
        removedStrokes: removedStrokes
    });

    // Clear the handwriting strokes that were processed
    const strokeSet = new Set(removedStrokes);
    page.strokes = page.strokes.filter(s => !strokeSet.has(s));

    // Clear selection if it was used
    state.hasSelection = false;
    state.selectionPath = [];

    saveToLocalStorage();
    redraw();
}

function isPointInPolygon(point, polygon) {
    let x = point.x, y = point.y;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        let xi = polygon[i].x, yi = polygon[i].y;
        let xj = polygon[j].x, yj = polygon[j].y;
        let intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// --- History & Persistence ---

function pushHistory(action) {
    state.historyStack.push(action);
    state.redoStack = [];
    if (state.historyStack.length > 50) state.historyStack.shift();
}

function wrapText(text, fontSize, rightBoundary, startX) {
    state.ctx.font = `${fontSize}px Inter, sans-serif`;
    const maxWidth = rightBoundary - startX;
    
    const words = text.replace(/\n/g, " \n ").split(/\s+/);
    let lines = [];
    let currentLine = "";

    words.forEach(word => {
        if (word === "\n") {
            lines.push(currentLine);
            currentLine = "";
            return;
        }
        
        let testLine = currentLine + (currentLine ? " " : "") + word;
        let metrics = state.ctx.measureText(testLine);
        
        if (metrics.width > maxWidth && currentLine !== "") {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    });
    
    if (currentLine) lines.push(currentLine);
    return lines.join("\n");
}

function getTextRightBoundary(textObj) {
    if (typeof textObj.width === 'number' && textObj.width > 0) {
        return textObj.x + textObj.width;
    }
    return state.width - 40;
}

function getWrapStartX(textObj) {
    if (typeof textObj.width === 'number' && textObj.width > 0) {
        return textObj.x;
    }
    if (textObj.align === 'center' || textObj.align === 'right') {
        return getTextBox(textObj).x;
    }
    return textObj.x;
}

function undo() {
    if (state.historyStack.length === 0) return;
    const action = state.historyStack.pop();
    state.redoStack.push(action);

    const page = state.pages[action.pageIndex];

    if (action.type === 'stroke') {
        page.strokes.pop();
    } else if (action.type === 'text_add') {
        page.texts = page.texts.filter(t => t !== action.obj);
        if (state.selectedText === action.obj) state.selectedText = null;
    } else if (action.type === 'ocr') {
        // Remove new text if it was created
        if (action.newTextObj) {
            page.texts = page.texts.filter(t => t !== action.newTextObj);
        }
        // Restore previous text if appended
        if (action.lastTextObj) {
            action.lastTextObj.text = action.lastTextOldValue;
        }
        // Restore strokes
        page.strokes = [...page.strokes, ...action.removedStrokes];
    }
    
    redraw();
    saveToLocalStorage();
}

function redo() {
    if (state.redoStack.length === 0) return;
    const action = state.redoStack.pop();
    state.historyStack.push(action);

    const page = state.pages[action.pageIndex];

    if (action.type === 'stroke') {
        page.strokes.push(action.stroke);
    } else if (action.type === 'text_add') {
        page.texts.push(action.obj);
    } else if (action.type === 'ocr') {
        if (action.newTextObj) page.texts.push(action.newTextObj);
        if (action.lastTextObj) {
            // Re-append: we need to figure out the text again or store the new value
            // To simplify, let's store both old and new in the action
            // Updating applyOCRResult to include new value
            action.lastTextObj.text = action.lastTextNewValue;
        }
        page.strokes = page.strokes.filter(s => !action.removedStrokes.includes(s));
    }

    redraw();
    saveToLocalStorage();
}

function clearPage() {
    if (confirm('Clear everything on this page?')) {
        const page = state.pages[state.pageIndex];
        page.strokes = [];
        page.texts = [];
        page.background = null;
        page._bgImg = null;
        hideFloatingUI();
        saveToLocalStorage();
        redraw();
    }
}

function hideFloatingUI() {
    state.selectedText = null;
    state.textEditing = null;
    state.hasSelection = false;
    state.selectionPath = [];
    document.getElementById('textEditorOverlay').style.display = 'none';
    document.getElementById('floatingFormatToolbar').style.display = 'none';
}

function downloadPDF() {
    if (state.textEditing) closeTextEditor();
    
    const cleanupPrintSheets = () => {
        const sheets = document.querySelectorAll('.print-sheet');
        sheets.forEach(s => s.remove());
    };

    window.removeEventListener('afterprint', cleanupPrintSheets);
    window.addEventListener('afterprint', cleanupPrintSheets, { once: true });

    const existingPrintSheets = document.querySelectorAll('.print-sheet');
    existingPrintSheets.forEach(s => s.remove());

    state.pages.forEach((page, i) => {
        const printSheet = document.createElement('div');
        printSheet.className = 'print-sheet';
        printSheet.style.display = 'none';
        
        if (state.layoutMode === 'ppt') {
            printSheet.style.width = '297mm';
            printSheet.style.height = '167mm'; // Approx 16:9 for A4 width
        } else {
            printSheet.style.width = '210mm';
            printSheet.style.height = '297mm';
        }
        
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = state.width;
        tempCanvas.height = state.height;
        const tctx = tempCanvas.getContext('2d');
        
        if (page.background) {
            const bgImg = new Image();
            bgImg.src = page.background;
            tctx.drawImage(bgImg, 0, 0);
        } else {
            tctx.fillStyle = '#ffffff';
            tctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        }
        
        page.strokes.forEach(s => {
            tctx.beginPath();
            tctx.strokeStyle = s.color;
            tctx.lineWidth = s.size;
            tctx.lineCap = 'round';
            tctx.lineJoin = 'round';
            s.points.forEach((p, idx) => {
                if (idx === 0) tctx.moveTo(p.x, p.y);
                else tctx.lineTo(p.x, p.y);
            });
            tctx.stroke();
        });

        const img = document.createElement('img');
        img.className = 'print-stroke-img';
        img.src = tempCanvas.toDataURL('image/png');
        printSheet.appendChild(img);

        page.texts.forEach(t => {
            const textDiv = document.createElement('div');
            textDiv.className = 'print-text';
            textDiv.style.left = t.x + 'px';
            textDiv.style.top = t.y + 'px';
            textDiv.style.fontSize = t.size + 'px';
            textDiv.style.color = t.color;
            textDiv.style.fontWeight = t.bold ? 'bold' : 'normal';
            textDiv.style.fontStyle = t.italic ? 'italic' : 'normal';
            textDiv.style.textDecoration = t.underline ? 'underline' : 'none';
            textDiv.style.backgroundColor = t.bgColor || 'transparent';
            
            if (t.isBullet) {
                const bullet = document.createElement('span');
                bullet.innerHTML = '• ';
                bullet.style.marginRight = (t.size * 0.5) + 'px';
                textDiv.appendChild(bullet);
            }
            
            const content = document.createElement('span');
            content.innerText = t.text;
            textDiv.appendChild(content);
            printSheet.appendChild(textDiv);
        });

        document.body.appendChild(printSheet);
    });

    // Wait a moment for the DOM/images to settle before printing
    setTimeout(() => {
        document.querySelectorAll('.print-sheet').forEach(s => {
            s.style.display = 'block';
        });
        window.print();
        cleanupPrintSheets();
    }, 500);
}

/**
 * PPT Export Functionality
 */
async function downloadPPT() {
    if (!window.PptxGenJS) {
        alert("PptxGenJS library not loaded. Please check your internet connection.");
        return;
    }

    const pptx = new PptxGenJS();
    // Define layout based on current mode
    const layoutName = state.layoutMode === 'ppt' ? 'LAYOUT_WIDE' : 'A4_PORTRAIT';
    
    if (state.layoutMode === 'pdf') {
        pptx.defineLayout({ name: 'A4_PORTRAIT', width: 8.27, height: 11.69 });
    }
    pptx.layout = layoutName;

    const btn = document.getElementById('btnDownloadPPT');
    const originalContent = btn.innerHTML;
    btn.innerHTML = '<i class="bi bi-hourglass-split"></i> <span>Saving...</span>';
    btn.disabled = true;

    try {
        for (let i = 0; i < state.pages.length; i++) {
            const page = state.pages[i];
            const slide = pptx.addSlide();

            // 1. Render Background and Strokes to Image
            const strokesImg = await getPageStrokesImage(page);
            
            // Add as background image (full page)
            slide.addImage({
                data: strokesImg,
                x: 0,
                y: 0,
                w: '100%',
                h: '100%'
            });

            // 2. Add Text Objects as editable layers
            page.texts.forEach(t => {
                const options = {
                    x: t.x / 96,
                    y: t.y / 96,
                    fontSize: t.size * 0.75, // Conversion from px to pt
                    color: (t.color || '#000000').replace('#', ''),
                    bold: !!t.bold,
                    italic: !!t.italic,
                    underline: !!t.underline,
                    align: t.align || 'left',
                    fontFace: t.fontFamily || 'Inter',
                    bullet: t.isBullet ? { indent: 20 } : false,
                    valign: 'top',
                    margin: 0
                };

                if (t.bgColor && t.bgColor !== 'transparent') {
                    options.fill = { color: t.bgColor.replace('#', '') };
                }

                if (t.width) {
                    options.w = t.width / 96;
                } else {
                    // Estimate width if not fixed to prevent auto-wrapping in PPT
                    options.autoFit = true;
                    options.shrinkText = false;
                }

                slide.addText(t.text, options);
            });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        await pptx.writeFile({ fileName: `Handwriting_Export_${timestamp}.pptx` });

    } catch (err) {
        console.error('PPT Export Error:', err);
        alert('Failed to export PPT: ' + err.message);
    } finally {
        btn.innerHTML = originalContent;
        btn.disabled = false;
    }
}

async function getPageStrokesImage(page) {
    return new Promise((resolve) => {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = state.width;
        tempCanvas.height = state.height;
        const tctx = tempCanvas.getContext('2d');

        const renderStrokes = () => {
            page.strokes.forEach(s => {
                tctx.beginPath();
                tctx.strokeStyle = s.color;
                tctx.lineWidth = s.size;
                tctx.lineCap = 'round';
                tctx.lineJoin = 'round';
                s.points.forEach((p, idx) => {
                    if (idx === 0) tctx.moveTo(p.x, p.y);
                    else tctx.lineTo(p.x, p.y);
                });
                tctx.stroke();
            });
            resolve(tempCanvas.toDataURL('image/png'));
        };

        if (page.background) {
            const bgImg = new Image();
            bgImg.crossOrigin = "anonymous"; // Try to avoid CORS issues
            bgImg.onload = () => {
                tctx.drawImage(bgImg, 0, 0, state.width, state.height);
                renderStrokes();
            };
            bgImg.onerror = () => {
                // Fallback to white if background fails
                tctx.fillStyle = '#ffffff';
                tctx.fillRect(0, 0, state.width, state.height);
                renderStrokes();
            };
            bgImg.src = page.background;
        } else {
            tctx.fillStyle = '#ffffff';
            tctx.fillRect(0, 0, state.width, state.height);
            renderStrokes();
        }
    });
}

function renderStrokesOnly() {
    const page = state.pages[state.pageIndex];
    state.ctx.clearRect(0, 0, state.width, state.height);
    state.ctx.fillStyle = '#ffffff';
    state.ctx.fillRect(0, 0, state.width, state.height);
    page.strokes.forEach(drawStroke);
}

function saveToLocalStorage() {
    const data = {
        pages: state.pages,
        layoutMode: state.layoutMode,
        timestamp: new Date().toISOString()
    };
    localStorage.setItem('handwriting_app_data', JSON.stringify(data));
    updateFileSizeDisplay();
}

function loadFromLocalStorage() {
    const dataStr = localStorage.getItem('handwriting_app_data');
    if (dataStr) {
        try {
            const data = JSON.parse(dataStr);
            state.pages = data.pages || [];
            
            if (data.layoutMode) {
                state.layoutMode = data.layoutMode;
                const sheet = document.getElementById('a4Sheet');
                if (state.layoutMode === 'ppt') {
                    state.width = 960;
                    state.height = 540;
                    sheet.classList.add('layout-ppt');
                } else {
                    state.width = 794;
                    state.height = 1123;
                    sheet.classList.remove('layout-ppt');
                }
            }

            // CLEANUP: Automatically remove any existing timestamps from saved data
            const timestampRegex = /\d{1,2}\/\d{1,2}\/\d{4}.*\d{1,2}:\d{2}/;
            state.pages.forEach(p => {
                if (Array.isArray(p.texts)) {
                    p.texts = p.texts.filter(t => !timestampRegex.test(t.text));
                }
            });
        } catch (e) {
            console.error('Failed to load data', e);
        }
    }
}

function setTool(tool) {
    if (state.tool !== tool) {
        hideFloatingUI();
    }
    state.tool = tool;
    document.querySelectorAll('.icon-tool-btn').forEach(btn => btn.classList.remove('active'));
    
    let btnId = 'btn' + tool.charAt(0).toUpperCase() + tool.slice(1);
    const activeBtn = document.getElementById(btnId);
    if (activeBtn) activeBtn.classList.add('active');

    // Show/hide property groups
    const penProps = document.getElementById('penProperties');
    const textProps = document.getElementById('textProperties');
    
    if (tool === 'pen' || tool === 'eraser') {
        penProps.style.display = 'flex';
        textProps.style.display = 'none';
    } else if (tool === 'text') {
        penProps.style.display = 'none';
        textProps.style.display = 'flex';
    } else {
        penProps.style.display = 'none';
        textProps.style.display = 'none';
    }
    redraw();
}

function updateUI() {
    // Update active button
    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
    const toolBtnMap = { 'pen': 'btnPen', 'eraser': 'btnEraser', 'select': 'btnSelect', 'text': 'btnText' };
    const activeBtnId = toolBtnMap[state.tool];
    if (activeBtnId) document.getElementById(activeBtnId).classList.add('active');

    // Show/hide property groups
    document.getElementById('penProperties').style.display = state.tool === 'pen' ? 'flex' : 'none';
    document.getElementById('textProperties').style.display = state.tool === 'text' ? 'flex' : 'none';

    // Update page indicator
    document.getElementById('pageIndicator').innerText = `${state.pageIndex + 1} / ${state.pages.length}`;
    
    // Update navigation buttons
    document.getElementById('btnPrev').disabled = state.pageIndex === 0;
    document.getElementById('btnNext').disabled = state.pageIndex === state.pages.length - 1;

    // Update layout buttons
    document.getElementById('btnLayoutPDF').classList.toggle('active', state.layoutMode === 'pdf');
    document.getElementById('btnLayoutPPT').classList.toggle('active', state.layoutMode === 'ppt');
}

function updateFileSizeDisplay() {
    const dataStr = localStorage.getItem('handwriting_app_data');
    if (dataStr) {
        const sizeKb = (dataStr.length / 1024).toFixed(1);
        document.getElementById('fileSizeInfo').innerText = `Size: ${sizeKb} KB`;
    }
}

function onKeyDown(e) {
    // Handle Ctrl+B / Ctrl+I / Ctrl+U inside the inline editor for per-word formatting
    if (e.target.isContentEditable && state.textEditing) {
        if (e.ctrlKey && (e.key === 'b' || e.key === 'B')) {
            e.preventDefault();
            toggleFormat('bold');
            return;
        }
        if (e.ctrlKey && (e.key === 'i' || e.key === 'I')) {
            e.preventDefault();
            toggleFormat('italic');
            return;
        }
        if (e.ctrlKey && (e.key === 'u' || e.key === 'U')) {
            e.preventDefault();
            toggleFormat('underline');
            return;
        }
        // Let all other keys (including Ctrl+Z, Ctrl+A, etc.) work natively in editor
        return;
    }

    // Don't trigger if typing in any other text field
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

    if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        undo();
    }
    if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        redo();
    }

    if (state.selectedText && !state.textEditing) {
        // Handle character keys, Backspace, and Enter to enter edit mode
        if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Enter') {
            e.preventDefault();
            
            const obj = state.selectedText;
            openTextEditor(obj);
            
            // Replay the key after editor is focused
            const editor = document.getElementById('inlineEditor');
            setTimeout(() => {
                if (e.key === 'Backspace') {
                    if (obj.text.length > 0) {
                        obj.text = obj.text.slice(0, -1);
                        editor.innerText = obj.text;
                    }
                } else if (e.key === 'Enter') {
                    obj.text += "\n";
                    editor.innerText = obj.text;
                } else if (e.key.length === 1) {
                    // If it was just "Type here...", replace it
                    if (obj.text === "Type here...") obj.text = "";
                    obj.text += e.key;
                    editor.innerText = obj.text;
                }
            }, 10);
        }

        if (e.key === 'Delete') {
            e.preventDefault();
            deleteSelectedText();
        }
    }
}

function deleteSelectedText() {
    if (!state.selectedText) return;
    
    // Push to history
    pushHistory({
        type: 'deleteText',
        pageIndex: state.pageIndex,
        textObj: state.selectedText
    });

    const page = state.pages[state.pageIndex];
    page.texts = page.texts.filter(t => t !== state.selectedText);
    state.selectedText = null;
    hideFloatingUI();
    saveToLocalStorage();
    redraw();
}



// Start the app
window.onload = init;
