function formatContent(selectedTags, brandName, descripcionInstalacion, numPermiso) {
    const currentDate = new Date().toISOString();
    
    // Validación de datos de entrada
    if (!descripcionInstalacion || !numPermiso) {
        throw new Error('Descripción de instalación y número de permiso son requeridos');
    }

    // Encabezado fijo del documento
    const fixedTags = `
    <Covol:DescripcionInstalacion>${escapeXml(descripcionInstalacion)}</Covol:DescripcionInstalacion>
    <Covol:NumPermiso>${escapeXml(numPermiso)}</Covol:NumPermiso>
    <Covol:FechaGeneracion>${currentDate}</Covol:FechaGeneracion>`;

    // Sección de producto
    const productSection = `
    <Covol:Producto>
        <Covol:MarcaComercial>${escapeXml(brandName)}</Covol:MarcaComercial>`;

    // Datos seleccionados
    const selectedData = selectedTags.map(tag => {
        if (!tag.tagName || !tag.content) {
            console.warn('Etiqueta inválida:', tag);
            return '';
        }
        return `        <${escapeXml(tag.tagName)}>${escapeXml(tag.content)}</${escapeXml(tag.tagName)}>`;
    }).join('\n');

    // XML completo
    return `<?xml version="1.0" encoding="UTF-8"?>
<Covol:Reporte xmlns:Covol="http://tusistema.com/covol">
${fixedTags}
${productSection}
${selectedData}
    </Covol:Producto>
</Covol:Reporte>`;
}

// Función para escapar caracteres especiales en XML
function escapeXml(unsafe) {
    if (!unsafe) return '';
    return unsafe.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

module.exports = {
    formatContent,
    escapeXml
};