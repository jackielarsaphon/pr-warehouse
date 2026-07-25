import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'

/**
 * Capture a DOM element and trigger browser download as PDF (Save As dialog).
 */
export async function downloadElementAsPdf(element, filename = 'document.pdf') {
  if (!element) throw new Error('ไม่พบเนื้อหาเอกสาร')

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    allowTaint: true,
    backgroundColor: '#ffffff',
    onclone: (doc) => {
      const clone = doc.getElementById(element.id) || doc.querySelector('#print-area-detail')
      if (clone) {
        clone.style.boxShadow = 'none'
        clone.style.transform = 'none'
        clone.style.margin = '0'
      }
    },
  })

  const imgData = canvas.toDataURL('image/jpeg', 0.95)
  const pdf = new jsPDF('p', 'mm', 'a4', true)
  const pageWidth = 210
  const pageHeight = 297
  const imgWidth = pageWidth
  const imgHeight = (canvas.height * imgWidth) / canvas.width
  let heightLeft = imgHeight
  let position = 0

  pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight, '', 'FAST')
  heightLeft -= pageHeight

  while (heightLeft > 0) {
    position = heightLeft - imgHeight
    pdf.addPage()
    pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight, '', 'FAST')
    heightLeft -= pageHeight
  }

  pdf.save(filename)
}
