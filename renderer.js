document.addEventListener('DOMContentLoaded', () => {
    let currentFilePath = null;
    let selectedBrand = null;
    let selectedUppercaseTag = null;
    let selectedTags = [];

    // Función para actualizar el estado
    function updateStatus(message, type = 'info') {
        const statusElement = document.getElementById('status');
        statusElement.innerHTML = `<i class="material-icons">${getStatusIcon(type)}</i><span>${message}</span>`;
        statusElement.className = `alert alert-${type}`;
    }

    // Obtener icono según el tipo de estado
    function getStatusIcon(type) {
        const icons = {
            'info': 'info',
            'success': 'check_circle',
            'warning': 'warning',
            'error': 'error'
        };
        return icons[type] || 'info';
    }

    // Cargar archivo XML
    async function selectFile() {
        try {
            const fileInfo = await window.electronAPI.openFileDialog();
            if (!fileInfo) {
                updateStatus('No se seleccionó ningún archivo', 'info');
                return;
            }

            currentFilePath = fileInfo.path;
            document.getElementById('file-info').innerHTML = 
                `<i class="material-icons">description</i><span>Archivo: ${fileInfo.name} (${fileInfo.size})</span>`;
            updateStatus('Archivo cargado exitosamente', 'success');

            // Obtener marcas comerciales
            const brands = await window.electronAPI.getBrandsFromFile(currentFilePath);
            const brandSelect = document.getElementById('brand-select');
            brandSelect.innerHTML = '<option value="">-- Seleccione una marca --</option>';
            
            brands.forEach(brand => {
                const option = document.createElement('option');
                option.value = brand;
                option.textContent = brand;
                brandSelect.appendChild(option);
            });

            // Actualizar tabla de marcas
            updateBrandsTable(brands);

            brandSelect.disabled = false;
            document.getElementById('brand-section').style.display = 'block';
        } catch (error) {
            console.error('Error al cargar archivo:', error);
            updateStatus(`Error: ${error.message}`, 'error');
        }
    }

    // Actualizar tabla de marcas
    function updateBrandsTable(brands) {
        const tableBody = document.getElementById('brand-table-body');
        tableBody.innerHTML = '';
        
        if (brands.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="4" style="text-align: center;">No se encontraron marcas</td></tr>';
            return;
        }

        brands.forEach(brand => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${brand}</td>
                <td>N/A</td>
                <td>N/A</td>
                <td>N/A</td>
            `;
            tableBody.appendChild(row);
        });
    }

    // Seleccionar marca comercial
    async function selectBrand() {
        selectedBrand = document.getElementById('brand-select').value;
        if (!selectedBrand) {
            updateStatus('Seleccione una marca comercial', 'warning');
            return;
        }

        try {
            const predefinedTags = ['RECEPCIONES', 'ENTREGAS', 'CONTROLDEEXISTENCIAS'];
            
            const uppercaseSelect = document.getElementById('uppercase-tag-select');
            uppercaseSelect.innerHTML = '<option value="">-- Seleccione una categoría --</option>';
            predefinedTags.forEach(tag => {
                const option = document.createElement('option');
                option.value = tag;
                option.textContent = tag;
                uppercaseSelect.appendChild(option);
            });

            uppercaseSelect.disabled = false;
            document.getElementById('search-section').style.display = 'block';
            updateStatus(`Marca "${selectedBrand}" seleccionada`, 'success');
        } catch (error) {
            console.error('Error al seleccionar marca:', error);
            updateStatus(`Error: ${error.message}`, 'error');
        }
    }

    // Seleccionar etiqueta en mayúsculas
    async function selectUppercaseTag() {
        selectedUppercaseTag = document.getElementById('uppercase-tag-select').value;
        if (!selectedUppercaseTag) {
            updateStatus('Seleccione una categoría', 'warning');
            return;
        }

        updateStatus(`Categoría "${selectedUppercaseTag}" seleccionada`, 'success');
    }

    // Buscar etiquetas generales
    async function searchGeneralTag() {
        const tagName = document.getElementById('tag-input').value.trim();
        if (!tagName) {
            updateStatus('Ingrese el nombre de la etiqueta a buscar', 'warning');
            return;
        }

        if (!selectedUppercaseTag) {
            updateStatus('Seleccione una categoría primero', 'warning');
            return;
        }

        try {
            const content = await window.electronAPI.findTagContent(
                currentFilePath,
                selectedBrand,
                selectedUppercaseTag,
                tagName
            );
            
            const resultTable = document.querySelector('#result');
            resultTable.innerHTML = `
                <thead>
                    <tr>
                        <th>Etiqueta</th>
                        <th>Valor</th>
                        <th>Acciones</th>
                    </tr>
                </thead>
                <tbody>
                    ${content ? `
                    <tr>
                        <td>${tagName}</td>
                        <td>${content}</td>
                        <td>
                            <button class="btn btn-sm btn-secondary" onclick="addToSelected('${tagName.replace(/'/g, "\\'")}', '${content.replace(/'/g, "\\'")}')">
                                <i class="material-icons">add</i> Seleccionar
                            </button>
                        </td>
                    </tr>
                    ` : `
                    <tr>
                        <td colspan="3" style="text-align: center;">No se encontraron resultados para "${tagName}"</td>
                    </tr>
                    `}
                </tbody>
            `;
            
            updateStatus('Búsqueda completada', 'success');
        } catch (error) {
            console.error('Error al buscar etiqueta general:', error);
            updateStatus(`Error: ${error.message}`, 'error');
        }
    }

    // Agregar etiqueta al archivo generado
    window.addToSelected = (tagName, content) => {
        const existingTag = selectedTags.find(tag => tag.tagName === tagName);
        if (existingTag) {
            updateStatus(`La etiqueta "${tagName}" ya ha sido seleccionada`, 'warning');
            return;
        }

        selectedTags.push({ tagName, content });
        updateSelectedTagsTable();
        document.getElementById('generate-section').style.display = 'block';
        updateStatus(`Etiqueta "${tagName}" agregada`, 'success');
    };

    // Actualizar tabla de etiquetas seleccionadas
    function updateSelectedTagsTable() {
        const tableBody = document.getElementById('selected-tags-table');
        const tagsContainer = document.getElementById('selected-tags-container');
        
        tableBody.innerHTML = '';
        tagsContainer.innerHTML = '';
        
        if (selectedTags.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="3" style="text-align: center;">No hay etiquetas seleccionadas</td></tr>';
            tagsContainer.innerHTML = '<span class="tag-chip">Ninguna etiqueta seleccionada</span>';
            return;
        }

        selectedTags.forEach(tag => {
            // Agregar a la tabla
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${tag.tagName}</td>
                <td>${tag.content}</td>
                <td>
                    <button class="btn btn-sm btn-secondary" onclick="removeSelectedTag('${tag.tagName.replace(/'/g, "\\'")}')">
                        <i class="material-icons">delete</i> Eliminar
                    </button>
                </td>
            `;
            tableBody.appendChild(row);
            
            // Agregar al contenedor de chips
            const chip = document.createElement('span');
            chip.className = 'tag-chip';
            chip.innerHTML = `
                ${tag.tagName}
                <span class="remove-btn material-icons" onclick="removeSelectedTag('${tag.tagName.replace(/'/g, "\\'")}')">close</span>
            `;
            tagsContainer.appendChild(chip);
        });
    };

    // Eliminar etiqueta seleccionada
    window.removeSelectedTag = (tagName) => {
        selectedTags = selectedTags.filter(tag => tag.tagName !== tagName);
        updateSelectedTagsTable();
        updateStatus(`Etiqueta "${tagName}" eliminada`, 'info');
        
        if (selectedTags.length === 0) {
            document.getElementById('generate-section').style.display = 'none';
        }
    };

    // Generar documento XML
    async function generateDocument() {
        try {
            if (selectedTags.length === 0) {
                updateStatus('No hay etiquetas seleccionadas', 'warning');
                throw new Error('Por favor seleccione al menos una etiqueta');
            }

            if (!selectedBrand) {
                updateStatus('No se ha seleccionado una marca', 'warning');
                throw new Error('Por favor seleccione una marca comercial');
            }

            if (!currentFilePath) {
                updateStatus('No hay archivo cargado', 'warning');
                throw new Error('Por favor cargue un archivo XML primero');
            }

            updateStatus('Generando documento...', 'info');

            // Mostrar barra de progreso
            const progressContainer = document.querySelector('.progress-container');
            const progressBar = document.querySelector('.progress-bar');
            progressContainer.style.display = 'block';
            progressBar.style.width = '30%';

            // Obtener datos fijos del archivo
            const fixedTags = await window.electronAPI.extractFixedTags(currentFilePath);
            progressBar.style.width = '60%';
            
            if (!fixedTags.descripcionInstalacion || !fixedTags.numPermiso) {
                throw new Error('El archivo XML no contiene los datos requeridos (DescripcionInstalacion y NumPermiso)');
            }

            // Formatear contenido XML
            const xmlContent = await window.electronAPI.formatContent(
                selectedTags,
                selectedBrand,
                fixedTags.descripcionInstalacion,
                fixedTags.numPermiso,
                'xml'
            );
            progressBar.style.width = '90%';

            if (typeof xmlContent !== 'string') {
                throw new Error('El contenido XML generado no es válido');
            }

            // Guardar el documento XML
            const savedPath = await window.electronAPI.saveFile(xmlContent, 'xml');
            progressBar.style.width = '100%';
            
            if (savedPath) {
                updateStatus(`Documento guardado en: ${savedPath}`, 'success');
                
                // Limpiar selecciones después de generar
                setTimeout(() => {
                    selectedTags = [];
                    updateSelectedTagsTable();
                    document.getElementById('generate-section').style.display = 'none';
                    progressContainer.style.display = 'none';
                    progressBar.style.width = '0%';
                }, 2000);
            } else {
                updateStatus('Generación cancelada', 'info');
                progressContainer.style.display = 'none';
                progressBar.style.width = '0%';
            }
        } catch (error) {
            console.error('Error al generar documento:', error);
            updateStatus(`Error: ${error.message}`, 'error');
            document.querySelector('.progress-container').style.display = 'none';
            document.querySelector('.progress-bar').style.width = '0%';
        }
    }

    // Event listeners
    document.getElementById('select-file').addEventListener('click', selectFile);
    document.getElementById('brand-select').addEventListener('change', selectBrand);
    document.getElementById('uppercase-tag-select').addEventListener('change', selectUppercaseTag);
    document.getElementById('search-btn').addEventListener('click', searchGeneralTag);
    document.getElementById('generate-doc-btn').addEventListener('click', generateDocument);
});