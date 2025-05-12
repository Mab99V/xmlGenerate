const { contextBridge, ipcRenderer } = require('electron');

// Función para escapar contenido y prevenir XSS
const sanitizeContent = (content) => {
    if (content === null || content === undefined) return '';
    return String(content)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

// Función para formatear contenido del reporte TXT
const formatTXTContent = (data) => {
    // Validación estricta de datos
    if (!data.selectedTags || !Array.isArray(data.selectedTags)) {
        throw new Error('Datos de tags seleccionados no válidos');
    }
    if (!data.descripcionInstalacion || !data.numPermiso) {
        throw new Error('Faltan metadatos requeridos para el reporte');
    }

    const now = new Date();
    const formatDate = () => now.toLocaleString('es-MX', {
        timeZone: 'America/Mexico_City',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });

    // Orden preferido de campos para cada categoría
    const FIELD_ORDER = {
        'RECEPCIONES': [
            'TotalRecepcionesMes',
            'ValorNumerico',
            'TotalDocumentosMes',
            'ImporteTotalRecepcionesMensual'
        ],
        'ENTREGAS': [
            'TotalEntregasMes',
            'ValorNumerico',
            'TotalDocumentosMes',
            'ImporteTotalEntregasMes'
        ],
        'CONTROLDEEXISTENCIAS': [
            'ValorNumerico'
        ]
    };

    // Agrupar datos por marca y mantener orden
    const groupedData = {};
    data.selectedTags.forEach(tag => {
        if (!groupedData[tag.brand]) {
            groupedData[tag.brand] = [];
        }
        groupedData[tag.brand].push({
            ...tag,
            // Normalizar el nombre del campo (key o subtag)
            fieldName: tag.key || tag.subtag
        });
    });

    // Generar contenido
    let content = '============================================\n';
    content += 'REPORTE DE COMBUSTIBLES\n';
    content += '============================================\n';
    content += `Instalación: ${sanitizeContent(data.descripcionInstalacion)}\n`;
    content += `Permiso CRE: ${sanitizeContent(data.numPermiso)}\n`;
    content += `Fecha: ${formatDate()}\n`;
    content += `Marcas: ${data.brands?.map(b => sanitizeContent(b)).join(', ') || 'No especificado'}\n`;
    content += '--------------------------------------------\n';
    content += 'DETALLES:\n';

    // Procesar cada marca en orden alfabético
    Object.keys(groupedData).sort().forEach(brand => {
        const brandTags = groupedData[brand];
        const category = brandTags[0]?.mainTag || 'RECEPCIONES';
        const fieldOrder = FIELD_ORDER[category] || [];

        // Mostrar campos en el orden específico
        fieldOrder.forEach(field => {
            const tag = brandTags.find(t => t.fieldName === field);
            if (tag) {
                content += `[${sanitizeContent(brand)}] ${sanitizeContent(category)} - ${sanitizeContent(field)}: ${sanitizeContent(tag.value)}\n`;
            }
        });
    });

    content += '============================================\n';
    return content;
};

// Función para formatear contenido del reporte PDF
const formatPDFContent = (data) => {
    const now = new Date();
    return {
        header: {
            title: 'REPORTE DE COMBUSTIBLES',
            installation: sanitizeContent(data.descripcionInstalacion),
            permit: sanitizeContent(data.numPermiso),
            date: now.toLocaleString('es-MX', {
                timeZone: 'America/Mexico_City',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }),
            brands: data.brands?.join(', ') || 'No especificado'
        },
        content: data.selectedTags.map(tag => ({
            brand: sanitizeContent(tag.brand),
            category: sanitizeContent(tag.mainTag || 'RECEPCIONES'),
            field: sanitizeContent(tag.key || tag.subtag),
            value: sanitizeContent(tag.value)
        }))
    };
};

// Función principal para formatear contenido
const formatReportContent = (data, formatType = 'txt') => {
    // Validación común
    if (!data || !data.selectedTags || !Array.isArray(data.selectedTags)) {
        throw new Error('Datos de reporte inválidos');
    }

    // Normalizar los datos seleccionados
    const normalizedTags = data.selectedTags.map(tag => ({
        brand: tag.brand || 'DESCONOCIDO',
        mainTag: tag.mainTag || 'RECEPCIONES',
        key: tag.key,
        subtag: tag.subtag,
        value: tag.value !== undefined ? tag.value : 'N/D'
    }));

    const reportData = {
        ...data,
        selectedTags: normalizedTags,
        brands: data.brands || [...new Set(normalizedTags.map(t => t.brand))]
    };

    return formatType === 'pdf' 
        ? formatPDFContent(reportData) 
        : formatTXTContent(reportData);
};

// API segura expuesta al renderer
contextBridge.exposeInMainWorld('electronAPI', {
    // Operaciones con archivos
    openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
    saveFile: (content, fileName, formatType = 'txt') => {
        if (!content) throw new Error('El contenido del archivo es requerido');
        return ipcRenderer.invoke('dialog:saveFile', {
            content: formatType === 'pdf' ? JSON.stringify(content) : content,
            defaultName: fileName || `reporte_${new Date().toISOString().slice(0,10)}.${formatType}`,
            formatType
        });
    },

    // Extracción de datos
    extractBrands: (filePath) => {
        if (!filePath) throw new Error('La ruta del archivo es requerida');
        return ipcRenderer.invoke('data:extractBrands', filePath);
    },
    
    getSubtagsByMainTag: (filePath, brandName, mainTag) => {
        if (!filePath || !mainTag) throw new Error('Parámetros requeridos faltantes');
        return ipcRenderer.invoke('data:getSubtags', { 
            filePath, 
            brandName: brandName || '', 
            mainTag 
        });
    },
    
    getSubtagValues: (filePath, brandName, mainTag, subtags) => {
        if (!filePath || !mainTag || !subtags?.length) {
            throw new Error('Parámetros requeridos faltantes');
        }
        return ipcRenderer.invoke('data:getValues', {
            filePath,
            brandName,
            mainTag,
            subtags: Array.isArray(subtags) ? subtags : [subtags]
        });
    },

    // Generación de reportes
    generateReport: (data, formatType = 'txt') => {
        const reportContent = formatReportContent(data, formatType);
        const fileName = `Reporte_Combustibles_${data.brands?.join('_') || 'multiples'}_${new Date().toISOString().slice(0,10)}.${formatType}`;
        
        return ipcRenderer.invoke('dialog:saveFile', {
            content: formatType === 'pdf' ? reportContent : reportContent,
            defaultName: fileName,
            formatType
        });
    },

    // Extracción de metadatos
    extractMetadata: (filePath) => {
        if (!filePath) throw new Error('La ruta del archivo es requerida');
        return ipcRenderer.invoke('data:extractMetadata', filePath);
    },

    // Utilidades
    formatContent: (data, formatType = 'txt') => {
        return formatReportContent(data, formatType);
    }
});

// Exponer función para mostrar notificaciones
contextBridge.exposeInMainWorld('notifications', {
    showNotification: (title, body) => {
        ipcRenderer.send('notification:show', { title, body });
    }
});