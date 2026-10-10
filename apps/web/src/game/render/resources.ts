import { Material, Texture, type BufferGeometry, type Object3D } from 'three';

/** Releases owned model resources once, including resources shared by several template roots.
 * Use only at the owner's teardown; removing a clone must leave its template alive. */
export class ResourceDisposer {
  private readonly released = new WeakSet<object>();

  release(resource: BufferGeometry | Material | Texture): void {
    if (this.released.has(resource)) return;
    this.released.add(resource);
    if (resource instanceof Material) {
      for (const value of Object.values(resource)) if (value instanceof Texture) this.release(value);
      const uniforms = (resource as Material & { uniforms?: Record<string, { value: unknown }> }).uniforms;
      for (const uniform of Object.values(uniforms ?? {})) {
        if (uniform.value instanceof Texture) this.release(uniform.value);
      }
    }
    resource.dispose();
    if (resource instanceof Texture && typeof ImageBitmap !== 'undefined') {
      const images: unknown[] = Array.isArray(resource.image) ? resource.image : [resource.image];
      for (const bitmap of images) if (bitmap instanceof ImageBitmap && !this.released.has(bitmap)) {
        this.released.add(bitmap);
        bitmap.close();
      }
    }
  }

  object(root: Object3D): void {
    root.traverse((node) => {
      const renderable = node as Object3D & { geometry?: BufferGeometry; material?: Material | Material[] };
      if (renderable.geometry) this.release(renderable.geometry);
      if (renderable.material) {
        for (const material of Array.isArray(renderable.material) ? renderable.material : [renderable.material]) this.release(material);
      }
    });
  }
}
