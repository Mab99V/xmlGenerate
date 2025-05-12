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

// Función para formatear contenido del reporte
const formatReportContent = (data, formatType = 'txt') => {
    const now = new Date();
    const formatDate = () => {
        return now.toLocaleString('es-MX', {
            timeZone: 'America/Mexico_City',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    // Validación de datos requeridos
    if (!data.selectedTags || !Array.isArray(data.selectedTags)) {
        throw new Error('Datos de tags seleccionados no válidos');
    }

    if (formatType === 'pdf') {
        return {
            header: {
                title: `Reporte de Combustibles - ${sanitizeContent(data.brandName || 'Múltiples Marcas')}`,
                installation: sanitizeContent(data.descripcionInstalacion || 'No especificado'),
                permit: sanitizeContent(data.numPermiso || 'No especificado'),
                date: formatDate()
            },
            content: data.selectedTags.map(tag => ({
                label: `${sanitizeContent(tag.brand)} - ${sanitizeContent(tag.mainTag)} - ${sanitizeContent(tag.subtag)}`,
                value: sanitizeContent(tag.value)
            }))
        };
    } else {
        // Formato TXT por defecto
        let content = `============================================\n`;
        content += `REPORTE DE COMBUSTIBLES\n`;
        content += `============================================\n`;
        content += `Instalación: ${sanitizeContent(data.descripcionInstalacion || 'No especificado')}\n`;
        content += `Permiso CRE: ${sanitizeContent(data.numPermiso || 'No especificado')}\n`;
        content += `Fecha: ${formatDate()}\n`;
        
        if (data.brandName) {
            content += `Marca: ${sanitizeContent(data.brandName)}\n`;
        } else if (data.brands?.length > 0) {
            content += `Marcas: ${data.brands.map(b => sanitizeContent(b)).join(', ')}\n`;
        }
        
        content += `--------------------------------------------\n`;
        content += `DETALLES:\n`;
        
        data.selectedTags.forEach(tag => {
            content += `[${sanitizeContent(tag.brand)}] ${sanitizeContent(tag.mainTag)} - ${sanitizeContent(tag.subtag)}: ${sanitizeContent(tag.value)}\n`;
        });
        
        content += `============================================\n`;
        return content;
    }
};

// API segura expuesta al renderer
contextBridge.exposeInMainWorld('electronAPI', {
    // Operaciones con archivos
    openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
    saveFile: (content, fileName, formatType = 'txt') => {
        if (!content) throw new Error('El contenido del archivo es requerido');
        return ipcRenderer.invoke('dialog:saveFile', {
            content,
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
        // Validación de datos requeridos
        if (!data?.selectedTags?.length) {
            throw new Error('No hay datos seleccionados para generar el reporte');
        }
        
        if (!data.descripcionInstalacion || !data.numPermiso) {
            throw new Error('Faltan metadatos requeridos para el reporte');
        }

        const reportContent = formatReportContent(data, formatType);
        const fileName = `reporte_${data.brandName || 'multiples'}_${new Date().toISOString().slice(0,10)}.${formatType}`;
        
        return ipcRenderer.invoke('dialog:saveFile', {
            content: formatType === 'pdf' ? JSON.stringify(reportContent) : reportContent,
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