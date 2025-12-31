declare module "gsap/utils/PathEditor" {
  export class PathEditor {
    static create(target: string | Element | null, vars?: object): any
    static register(core: any): void
    kill(): void
  }
  export default PathEditor
}
