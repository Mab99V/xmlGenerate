const fs = require('fs');
const xml2js = require('xml2js');

// Función para extraer marcas comerciales
async function extractBrands(filePath) {
    try {
        const xmlData = fs.readFileSync(filePath, 'utf-8');
        
        const parser = new xml2js.Parser({
            explicitArray: false,
            xmlns: true,
            ignoreAttrs: true,
            explicitCharkey: true,
            preserveChildrenOrder: true,
            tagNameProcessors: [xml2js.processors.stripPrefix]
        });

        const result = await parser.parseStringPromise(xmlData);
        const brands = new Set();

        // Función recursiva para buscar marcas comerciales
        const findBrands = (node) => {
            if (!node) return;

            if (node.MarcaComercial) {
                const brand = typeof node.MarcaComercial === 'string' 
                    ? node.MarcaComercial 
                    : (node.MarcaComercial._ || '');
                if (brand.trim() !== '') {
                    brands.add(brand.trim());
                }
            }

            Object.values(node).forEach(child => {
                if (typeof child === 'object') {
                    findBrands(child);
                }
            });
        };

        findBrands(result);
        return Array.from(brands).filter(b => b);

    } catch (error) {
        console.error('Error en extractBrands:', error);
        throw new Error(`Error procesando XML: ${error.message}`);
    }
}

// Función para buscar el contenido de una etiqueta específica en el contexto de una marca
async function findTagContent(filePath, brandName, tagName) {
    try {
        const xmlData = fs.readFileSync(filePath, 'utf-8');
        const parser = new xml2js.Parser({
            explicitArray: false,
            xmlns: true,
            ignoreAttrs: true,
            explicitCharkey: true,
            preserveChildrenOrder: true,
            tagNameProcessors: [xml2js.processors.stripPrefix]
        });

        const result = await parser.parseStringPromise(xmlData);
        let foundContent = null;

        const searchTag = (node, inBrandContext = false) => {
            if (!node || foundContent) return;

            // Verificar si estamos en el nodo de la marca correcta
            if (node.MarcaComercial) {
                const currentBrand = typeof node.MarcaComercial === 'string' 
                    ? node.MarcaComercial 
                    : (node.MarcaComercial._ || '');
                inBrandContext = (currentBrand.trim() === brandName.trim());
            }

            // Buscar la etiqueta si estamos en el contexto correcto
            if (inBrandContext) {
                // Eliminar namespace si está presente
                const cleanTagName = tagName.replace('Covol:', '');
                
                if (node[cleanTagName]) {
                    foundContent = typeof node[cleanTagName] === 'string' 
                        ? node[cleanTagName] 
                        : (node[cleanTagName]._ || '');
                    return;
                }
            }

            // Buscar recursivamente
            Object.values(node).forEach(child => {
                if (typeof child === 'object') {
                    searchTag(child, inBrandContext);
                }
            });
        };

        searchTag(result);
        return foundContent;

    } catch (error) {
        console.error('Error en findTagContent:', error);
        throw new Error(`Error buscando etiqueta: ${error.message}`);
    }
}

// Función para buscar etiquetas en mayúsculas
async function findUppercaseTags(filePath, brandName) {
    try {
        const xmlData = fs.readFileSync(filePath, 'utf-8');
        const parser = new xml2js.Parser({ explicitArray: false });
        const result = await parser.parseStringPromise(xmlData);

        const uppercaseTags = new Set();

        const searchUppercaseTags = (node, inBrandContext = false) => {
            if (!node) return;

            if (node.MarcaComercial) {
                inBrandContext = (node.MarcaComercial.trim() === brandName.trim());
            }

            if (inBrandContext) {
                Object.keys(node).forEach(key => {
                    if (key === key.toUpperCase() && key.startsWith('Covol:')) {
                        uppercaseTags.add(key);
                    }
                });
            }

            Object.values(node).forEach(child => {
                if (typeof child === 'object') {
                    searchUppercaseTags(child, inBrandContext);
                }
            });
        };

        searchUppercaseTags(result);
        return Array.from(uppercaseTags);
    } catch (error) {
        console.error('Error en findUppercaseTags:', error);
        throw new Error(`Error buscando etiquetas en mayúsculas: ${error.message}`);
    }
}

// Función para buscar subetiquetas dentro de una etiqueta en mayúsculas
async function findSubtagContent(filePath, brandName, uppercaseTag, subtagName) {
    try {
        const xmlData = fs.readFileSync(filePath, 'utf-8');
        const parser = new xml2js.Parser({ explicitArray: false });
        const result = await parser.parseStringPromise(xmlData);

        let foundContent = null;

        const searchSubtag = (node, inTagContext = false) => {
            if (!node || foundContent) return;

            if (node.MarcaComercial) {
                inTagContext = (node.MarcaComercial.trim() === brandName.trim());
            }

            if (inTagContext && node[uppercaseTag]) {
                const tagNode = node[uppercaseTag];
                if (tagNode[subtagName]) {
                    foundContent = tagNode[subtagName];
                }
            }

            Object.values(node).forEach(child => {
                if (typeof child === 'object') {
                    searchSubtag(child, inTagContext);
                }
            });
        };

        searchSubtag(result);
        return foundContent;
    } catch (error) {
        console.error('Error en findSubtagContent:', error);
        throw new Error(`Error buscando subetiqueta: ${error.message}`);
    }
}

// Función para generar un archivo XML a partir de etiquetas seleccionadas
function generateXMLFile(selectedTags, outputPath) {
    try {
        if (!selectedTags || selectedTags.length === 0) {
            throw new Error('No hay etiquetas seleccionadas para generar el XML.');
        }

        // Crear estructura XML
        const xmlBuilder = new xml2js.Builder({ rootName: 'Etiquetas', xmldec: { version: '1.0', encoding: 'UTF-8' } });
        const xmlData = {
            Etiqueta: selectedTags.map(tag => ({
                Marca: tag.brandName,
                Nombre: tag.tagName
            }))
        };

        // Generar XML
        const xmlContent = xmlBuilder.buildObject(xmlData);

        // Guardar en archivo
        fs.writeFileSync(outputPath, xmlContent, 'utf-8');
        console.log(`Archivo XML generado en: ${outputPath}`);
        return outputPath;

    } catch (error) {
        console.error('Error al generar el archivo XML:', error);
        throw new Error(`Error generando XML: ${error.message}`);
    }
}

module.exports = { extractBrands, findTagContent, findUppercaseTags, findSubtagContent, generateXMLFile };