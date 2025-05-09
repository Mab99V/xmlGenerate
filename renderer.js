document.addEventListener('DOMContentLoaded', () => {
    // Verificar que los elementos del DOM existen
    const selectFileBtn = document.getElementById('select-file-btn');
    const brandSelect = document.getElementById('brand-select');
    const mainTagSelect = document.getElementById('main-tag-select');
    const searchBtn = document.getElementById('search-btn');
    const generateTxtBtn = document.getElementById('generate-txt-btn');
    const generatePdfBtn = document.getElementById('generate-pdf-btn');

    if (!selectFileBtn || !brandSelect || !mainTagSelect || !searchBtn || !generateTxtBtn || !generatePdfBtn) {
        console.error('Error: No se encontraron todos los elementos necesarios en el DOM');
        return;
    }

    let currentFilePath = null;
    let selectedBrand = null;
    let selectedMainTag = null;
    let selectedSubtags = [];
    let availableSubtags = [];

    // Función para actualizar el estado con validación
    function updateStatus(message, type = 'info') {
        const statusElement = document.getElementById('status');
        if (!statusElement) {
            console.error('Elemento de estado no encontrado');
            return;
        }

        const icons = {
            'info': 'info-circle',
            'success': 'check-circle',
            'warning': 'exclamation-triangle',
            'error': 'x-circle'
        };

        statusElement.innerHTML = `<i class="bi bi-${icons[type] || 'info-circle'}"></i><span>${message}</span>`;
        statusElement.className = `alert alert-${type}`;
    }

    // Función para cargar archivo con validación mejorada
    async function selectFile() {
        try {
            updateStatus('Cargando archivo...', 'info');
            
            const fileInfo = await window.electronAPI.openFileDialog();
            if (!fileInfo || !fileInfo.path) {
                updateStatus('No se seleccionó ningún archivo', 'info');
                return;
            }

            // Validar extensión del archivo
            if (!fileInfo.path.toLowerCase().endsWith('.xml')) {
                updateStatus('Por favor seleccione un archivo XML', 'warning');
                return;
            }

            currentFilePath = fileInfo.path;
            document.getElementById('file-info').innerHTML = 
                `<i class="bi bi-file-earmark-text"></i><span>Archivo: ${path.basename(fileInfo.path)} (${fileInfo.size})</span>`;

            // Cargar marcas comerciales con manejo de errores
            const brands = await window.electronAPI.extractBrands(currentFilePath);
            if (!brands || brands.length === 0) {
                updateStatus('El archivo no contiene marcas comerciales válidas', 'warning');
                return;
            }

            // Actualizar selector de marcas
            brandSelect.innerHTML = '<option value="">-- Seleccione una marca --</option>';
            brands.forEach(brand => {
                const option = document.createElement('option');
                option.value = brand;
                option.textContent = brand;
                brandSelect.appendChild(option);
            });

            brandSelect.disabled = false;
            document.getElementById('brand-section').style.display = 'block';
            updateStatus('Archivo cargado exitosamente', 'success');

        } catch (error) {
            console.error('Error al cargar archivo:', error);
            updateStatus(`Error: ${error.message}`, 'error');
        }
    }

    // Función para seleccionar marca comercial
    async function selectBrand() {
        selectedBrand = brandSelect.value;
        if (!selectedBrand) {
            updateStatus('Seleccione una marca comercial', 'warning');
            return;
        }

        try {
            mainTagSelect.innerHTML = '<option value="">-- Seleccione una categoría --</option>';
            const mainTags = ['RECEPCIONES', 'CONTROLDEEXISTENCIAS', 'ENTREGAS'];
            
            mainTags.forEach(tag => {
                const option = document.createElement('option');
                option.value = tag;
                option.textContent = tag;
                mainTagSelect.appendChild(option);
            });

            mainTagSelect.disabled = false;
            document.getElementById('category-section').style.display = 'block';
            updateStatus(`Marca "${selectedBrand}" seleccionada`, 'success');

        } catch (error) {
            console.error('Error al seleccionar marca:', error);
            updateStatus(`Error: ${error.message}`, 'error');
        }
    }

    // Función para seleccionar categoría principal
    async function selectMainTag() {
        selectedMainTag = mainTagSelect.value;
        if (!selectedMainTag) {
            updateStatus('Seleccione una categoría', 'warning');
            return;
        }

        try {
            // Obtener subetiquetas disponibles
            availableSubtags = await window.electronAPI.getSubtagsByMainTag(
                currentFilePath, 
                selectedBrand, 
                selectedMainTag
            );

            const subtagsContainer = document.getElementById('subtags-container');
            subtagsContainer.innerHTML = '';
            
            if (!availableSubtags || availableSubtags.length === 0) {
                subtagsContainer.innerHTML = '<p class="text-muted">No se encontraron subetiquetas para esta categoría</p>';
                return;
            }

            availableSubtags.forEach(subtag => {
                const div = document.createElement('div');
                div.className = 'form-check mb-2';
                div.innerHTML = `
                    <input class="form-check-input" type="checkbox" value="${subtag}" id="subtag-${subtag}">
                    <label class="form-check-label" for="subtag-${subtag}">
                        ${subtag}
                    </label>
                `;
                subtagsContainer.appendChild(div);
            });

            document.getElementById('subtags-section').style.display = 'block';
            searchBtn.disabled = false;
            updateStatus(`Categoría "${selectedMainTag}" seleccionada`, 'success');

        } catch (error) {
            console.error('Error al seleccionar categoría:', error);
            updateStatus(`Error: ${error.message}`, 'error');
        }
    }

    // Función para buscar datos
    async function searchData() {
        try {
            const checkboxes = document.querySelectorAll('#subtags-container input[type="checkbox"]:checked');
            if (checkboxes.length === 0) {
                updateStatus('Seleccione al menos una subetiqueta', 'warning');
                return;
            }

            const subtags = Array.from(checkboxes).map(cb => cb.value);
            updateStatus('Buscando datos...', 'info');

            const values = await window.electronAPI.getSubtagValues(
                currentFilePath,
                selectedBrand,
                selectedMainTag,
                subtags
            );

            // Mostrar resultados
            const resultsTable = document.getElementById('results-table');
            if (!resultsTable) {
                throw new Error('Tabla de resultados no encontrada');
            }

            resultsTable.innerHTML = `
                <thead class="table-dark">
                    <tr>
                        <th>Dato</th>
                        <th>Valor</th>
                        <th>Acción</th>
                    </tr>
                </thead>
                <tbody>
                    ${Object.entries(values).map(([key, value]) => `
                        <tr>
                            <td>${key}</td>
                            <td>${value || 'N/A'}</td>
                            <td>
                                <button class="btn btn-sm btn-success" 
                                    onclick="addToSelected('${key.replace(/'/g, "\\'")}', '${String(value || '').replace(/'/g, "\\'")}')">
                                    <i class="bi bi-plus-lg"></i> Agregar
                                </button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            `;

            document.getElementById('results-section').style.display = 'block';
            updateStatus('Datos encontrados correctamente', 'success');

        } catch (error) {
            console.error('Error al buscar datos:', error);
            updateStatus(`Error: ${error.message}`, 'error');
        }
    }

    // Función para agregar items seleccionados (expuesta globalmente)
    window.addToSelected = (subtag, value) => {
        if (selectedSubtags.some(item => item.subtag === subtag)) {
            updateStatus(`"${subtag}" ya está seleccionado`, 'warning');
            return;
        }

        selectedSubtags.push({
            subtag,
            value,
            mainTag: selectedMainTag,
            brand: selectedBrand
        });

        updateSelectedTags();
        document.getElementById('generate-section').style.display = 'block';
        updateStatus(`"${subtag}" agregado al reporte`, 'success');
    };

    // Función para actualizar la lista de seleccionados
    function updateSelectedTags() {
        const container = document.getElementById('selected-tags-container');
        const tableBody = document.getElementById('selected-tags-body');
        
        if (!container || !tableBody) {
            console.error('Elementos de selección no encontrados');
            return;
        }

        // Actualizar chips
        container.innerHTML = selectedSubtags.length > 0 
            ? selectedSubtags.map(tag => `
                <span class="tag-chip">
                    ${tag.subtag}
                    <span class="remove-btn" onclick="removeSelectedTag('${tag.subtag.replace(/'/g, "\\'")}')">
                        <i class="bi bi-x"></i>
                    </span>
                </span>
              `).join('')
            : '<span class="tag-chip">No hay datos seleccionados</span>';

        // Actualizar tabla
        tableBody.innerHTML = selectedSubtags.length > 0
            ? selectedSubtags.map((tag, index) => `
                <tr>
                    <td>${tag.brand}</td>
                    <td>${tag.mainTag}</td>
                    <td>${tag.subtag}</td>
                    <td>${tag.value}</td>
                    <td>
                        <button class="btn btn-sm btn-danger" 
                            onclick="removeSelectedTag('${tag.subtag.replace(/'/g, "\\'")}')">
                            <i class="bi bi-trash"></i>
                        </button>
                    </td>
                </tr>
              `).join('')
            : '<tr><td colspan="5" class="text-center">No hay datos seleccionados</td></tr>';
    }

    // Función para eliminar items seleccionados (expuesta globalmente)
    window.removeSelectedTag = (subtag) => {
        selectedSubtags = selectedSubtags.filter(item => item.subtag !== subtag);
        updateSelectedTags();
        
        if (selectedSubtags.length === 0) {
            document.getElementById('generate-section').style.display = 'none';
        }
        
        updateStatus(`"${subtag}" removido del reporte`, 'info');
    };

    // Función para generar reporte en TXT
    async function generateTxtReport() {
        try {
            if (selectedSubtags.length === 0) {
                updateStatus('No hay datos seleccionados', 'warning');
                return;
            }

            updateStatus('Generando reporte TXT...', 'info');
            showProgress(25);

            const metadata = await window.electronAPI.extractMetadata(currentFilePath);
            const reportContent = await window.electronAPI.formatContent({
                selectedTags: selectedSubtags,
                brandName: selectedBrand,
                descripcionInstalacion: metadata.descripcionInstalacion,
                numPermiso: metadata.numPermiso,
                formatType: 'txt'
            });

            const reportPath = await window.electronAPI.saveFile(reportContent, 'txt');
            
            showProgress(100);
            updateStatus(`Reporte TXT generado: ${path.basename(reportPath)}`, 'success');
            resetProgressAfterDelay();

        } catch (error) {
            console.error('Error al generar TXT:', error);
            updateStatus(`Error al generar TXT: ${error.message}`, 'error');
            resetProgress();
        }
    }

    // Función para generar reporte en PDF
    async function generatePdfReport() {
        try {
            if (selectedSubtags.length === 0) {
                updateStatus('No hay datos seleccionados', 'warning');
                return;
            }

            updateStatus('Generando reporte PDF...', 'info');
            showProgress(25);

            const metadata = await window.electronAPI.extractMetadata(currentFilePath);
            const reportData = {
                selectedTags: selectedSubtags,
                brandName: selectedBrand,
                descripcionInstalacion: metadata.descripcionInstalacion,
                numPermiso: metadata.numPermiso,
                formatType: 'pdf'
            };

            const reportPath = await window.electronAPI.generateReport(reportData, 'pdf');
            
            showProgress(100);
            updateStatus(`Reporte PDF generado: ${path.basename(reportPath)}`, 'success');
            resetProgressAfterDelay();

        } catch (error) {
            console.error('Error al generar PDF:', error);
            updateStatus(`Error al generar PDF: ${error.message}`, 'error');
            resetProgress();
        }
    }

    // Funciones auxiliares para la barra de progreso
    function showProgress(percent) {
        const progressBar = document.getElementById('progress-bar');
        if (progressBar) {
            progressBar.style.width = `${percent}%`;
            progressBar.style.display = 'block';
        }
    }

    function resetProgress() {
        const progressBar = document.getElementById('progress-bar');
        if (progressBar) {
            progressBar.style.width = '0%';
            progressBar.style.display = 'none';
        }
    }

    function resetProgressAfterDelay(delay = 3000) {
        setTimeout(resetProgress, delay);
    }

    // Asignar event listeners
    selectFileBtn.addEventListener('click', selectFile);
    brandSelect.addEventListener('change', selectBrand);
    mainTagSelect.addEventListener('change', selectMainTag);
    searchBtn.addEventListener('click', searchData);
    generateTxtBtn.addEventListener('click', generateTxtReport);
    generatePdfBtn.addEventListener('click', generatePdfReport);

    // Polyfill para path.basename
    const path = {
        basename: (filePath) => {
            return filePath.split(/[\\/]/).pop();
        }
    };
});