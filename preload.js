const { contextBridge, ipcRenderer } = require('electron');

// Función para formatear contenido con seguridad
const formatContent = (selectedTags, brandName, installationDesc, permitNumber, formatType = 'txt') => {
    const currentDate = new Date();
    
    const escapeContent = (content) => {
        if (!content) return '';
        return String(content);
    };

    const formatDate = () => {
        return currentDate.toLocaleString('es-MX', { 
            timeZone: 'America/Mexico_City',
            year: 'numeric', 
            month: '2-digit', 
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    };

    if (formatType === 'pdf') {
        // Estructura básica para PDF (será formateado por el backend)
        return {
            header: {
                title: `Reporte de Operaciones - ${brandName}`,
                date: formatDate(),
                installation: installationDesc,
                permit: permitNumber
            },
            content: selectedTags.map(tag => ({
                label: tag.tagName,
                value: tag.content
            }))
        };
    } else {
        // Formato TXT por defecto
        return `======================================
Empresa: ${escapeContent(installationDesc)}
Permiso CRE: ${escapeContent(permitNumber)}
Generación del Archivo: ${formatDate()}
--------------------------------------
Producto: ${escapeContent(brandName)}
${selectedTags.map(tag => `  ${escapeContent(tag.tagName)}: ${escapeContent(tag.content)}`).join('\n')}
======================================`;
    }
};

// API expuesta al renderer
contextBridge.exposeInMainWorld('electronAPI', {
    // Operaciones con archivos
    openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
    saveFile: (content, formatType = 'txt') => ipcRenderer.invoke('dialog:saveFile', { 
        content, 
        defaultName: `reporte_${new Date().toISOString().slice(0,10)}.${formatType}`
    }),

    // Procesamiento de datos
    extractBrands: (filePath) => ipcRenderer.invoke('data:extractBrands', filePath),
    getSubtagsByMainTag: (filePath, brandName, mainTag) => 
        ipcRenderer.invoke('data:getSubtags', { filePath, brandName, mainTag }),
    getSubtagValues: (filePath, brandName, mainTag, subtags) => 
        ipcRenderer.invoke('data:getValues', { filePath, brandName, mainTag, subtags }),
    
    // Generación de reportes
    generateReport: (data, formatType = 'txt') => {
        if (!data.descripcionInstalacion || !data.numPermiso) {
            throw new Error('Faltan datos requeridos: descripcionInstalacion y numPermiso');
        }
        
        const reportData = formatContent(
            data.selectedTags || [],
            data.brandName || '',
            data.descripcionInstalacion,
            data.numPermiso,
            formatType
        );
        
        return ipcRenderer.invoke('report:generate', {
            data: reportData,
            formatType
        });
    },
    
    // Extracción de metadatos
    extractMetadata: (filePath) => ipcRenderer.invoke('data:extractMetadata', filePath)
});