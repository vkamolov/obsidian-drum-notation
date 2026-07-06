// The vexflow package does not export its font-data modules through its
// export map. esbuild resolves these specifiers via the alias entries in
// esbuild.config.mjs to the same files the vexflow/bravura entry bundles.
declare module "vexflow-fonts/bravura" {
  export const Bravura: string;
}

declare module "vexflow-fonts/academico" {
  export const Academico: string;
}

declare module "vexflow-fonts/academicobold" {
  export const AcademicoBold: string;
}
