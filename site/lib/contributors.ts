import type { Messages } from "./site";

export type Contributor = {
  name: string;
  /** Key in `contributors.roles` of the messages; left out when the person gave none. */
  role?: keyof Messages["contributors"]["roles"];
  org: string;
  /** Where the name leads: the person's or the group's own page. */
  url: string;
  /** Photo or logo in public/people (square). Without one the card shows the initials. */
  image?: string;
};

/** People and groups behind the project, in the order they appear on the page. */
export const CONTRIBUTORS: Contributor[] = [
  { name: "Cristiano Scarpelli", org: "Ciclorota BH", url: "https://www.instagram.com/ciclorotabh/" },
  {
    name: "Rafael Schettino",
    role: "programmer",
    org: "SKET Tecnologia",
    url: "https://github.com/rafaels-dev",
    image: "/people/rafael-schettino.jpg",
  },
];
