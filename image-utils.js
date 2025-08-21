import Jimp from 'jimp';

// Преоразмерява изображение до квадратна резолюция size x size.
export async function resizeToStandard(image, size = 1024) {
    return image.contain(size, size);
}

// Премахва черните рамки около изображението.
export async function autoCropBlackBorders(image) {
    return image.autocrop({
        cropSymmetric: true,
        tolerance: 0.0001,
        leaveBorder: 0,
        color: 0x000000FF
    });
}

// Нормализира яркост и контраст.
export async function normalizeBrightnessContrast(image) {
    image.normalize();
    return image;
}

// Комбинира всички стъпки и връща нов File с обработено изображение.
export async function preprocessImage(file, size = 1024) {
    try {
        const buffer = Buffer.from(await file.arrayBuffer());
        let image = await Jimp.read(buffer);
        image = await autoCropBlackBorders(image);
        image = await resizeToStandard(image, size);
        image = await normalizeBrightnessContrast(image);
        const outBuffer = await image.getBufferAsync(Jimp.MIME_PNG);
        return new File([outBuffer], file.name || 'processed.png', { type: 'image/png' });
    } catch (err) {
        // При неуспех връщаме оригиналния файл
        return file;
    }
}
