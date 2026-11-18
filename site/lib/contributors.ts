import type { Messages } from "./site";

export type Contributor = {
  name: string;
  /** Key in `contributors.roles` of the messages; left out when the person gave none. */
  role?: keyof Messages["contributors"]["roles"];
  org: string;
  /** The group's own page. */
  orgUrl?: string;
  /** The person's own page. */
  url?: string;
  /** Photo or logo in public/people (square). Without one the card shows the initials. */
  image?: string;
};

/** People and groups behind the project, in the order they appear on the page. */
export const CONTRIBUTORS: Contributor[] = [
  {
    name: "Cristiano Scarpelli",
    org: "Ciclorota BH",
    orgUrl: "https://www.instagram.com/ciclorotabh/",
    image: "/people/cristiano-scarpelli.jpg",
  },
  {
    name: "Rafael Schettino",
    role: "programmer",
    org: "SKET Tecnologia",
    url: "https://github.com/rafaels-dev",
    image: "/people/rafael-schettino.jpg",
  },
];
