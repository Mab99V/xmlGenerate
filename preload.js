const { contextBridge, ipcRenderer } = require('electron');

const XML_NAMESPACE = "http://tusistema.com/covol";

const formatContent = (selectedTags, brandName, descripcionInstalacion, numPermiso, formatType = 'xml') => {
    const currentDate = new Date();
    
    const escapeContent = (unsafe, isXml = true) => {
        if (!unsafe) return '';
        const str = unsafe.toString();
        return isXml 
            ? str.replace(/&/g, '&amp;')
                 .replace(/</g, '&lt;')
                 .replace(/>/g, '&gt;')
                 .replace(/"/g, '&quot;')
                 .replace(/'/g, '&apos;')
            : str;
    };

    const formatDate = (date, isXml = true) => {
        return isXml 
            ? date.toISOString()
            : date.toLocaleString('es-MX', { 
                timeZone: 'America/Mexico_City',
                year: 'numeric', 
                month: '2-digit', 
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              });
    };

    if (formatType === 'xml') {
        return `<?xml version="1.0" encoding="UTF-8"?>
<Covol:Reporte xmlns:Covol="${XML_NAMESPACE}">
    <Covol:DescripcionInstalacion>${escapeContent(descripcionInstalacion)}</Covol:DescripcionInstalacion>
    <Covol:NumPermiso>${escapeContent(numPermiso)}</Covol:NumPermiso>
    <Covol:FechaGeneracion>${formatDate(currentDate)}</Covol:FechaGeneracion>
    <Covol:Producto>
        <Covol:MarcaComercial>${escapeContent(brandName)}</Covol:MarcaComercial>
${selectedTags.map(tag => `        <${escapeContent(tag.tagName)}>${escapeContent(tag.content)}</${escapeContent(tag.tagName)}>`).join('\n')}
    </Covol:Producto>
</Covol:Reporte>`;
    } else {
        return `======================================
Empresa: ${escapeContent(descripcionInstalacion, false)}
Permiso CRE: ${escapeContent(numPermiso, false)}
Generación del Archivo: ${formatDate(currentDate, false)}
--------------------------------------
Producto: ${escapeContent(brandName, false)}
${selectedTags.map(tag => `  ${escapeContent(tag.tagName, false)}: ${escapeContent(tag.content, false)}`).join('\n')}`;
    }
};

contextBridge.exposeInMainWorld('electronAPI', {
    // Funciones de archivo
    openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
    saveFile: (content, formatType = 'xml') => {
        const contentToSend = typeof content === 'string' ? content : String(content);
        return ipcRenderer.invoke('save-file', {
            content: contentToSend,
            defaultName: formatType === 'xml' ? 'reporte.xml' : 'reporte.txt'
        });
    },
    
    // Funciones de extracción de datos
    getBrandsFromFile: (filePath) => ipcRenderer.invoke('extract-brands', filePath),
    findUppercaseTags: (filePath, brandName) => ipcRenderer.invoke('find-uppercase-tags', filePath, brandName),
    findTagContent: (filePath, brand, uppercaseTag, tagName) => 
        ipcRenderer.invoke('find-tag-content', filePath, brand, uppercaseTag, tagName),
    extractFixedTags: (filePath) => ipcRenderer.invoke('extract-fixed-tags', filePath),
    
    // Función de formateo
    formatContent: (selectedTags, brandName, descripcionInstalacion, numPermiso, formatType) => {
        if (!descripcionInstalacion || !numPermiso) {
            throw new Error('Los datos de DescripcionInstalacion y NumPermiso son requeridos');
        }
        
        return formatContent(
            selectedTags || [],
            brandName || '',
            descripcionInstalacion,
            numPermiso,
            formatType || 'xml'
        );
    }
});