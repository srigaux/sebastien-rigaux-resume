import React from 'react';

import { graphql } from 'gatsby';

//import 'boostrap';

import Layout from '../components/Layout';

//import { Link } from 'gatsby';
import Sidebar from '../components/Sidebar';
import config from '../../config';
import About from '../components/Sections/About';
import Experience from '../components/Sections/Experience';
import Education from '../components/Sections/Education';
import Skills from '../components/Sections/Skills';
import SEO from '../components/SEO';

const IndexPage = ({ data }) => (
  <Layout>
    <SEO />
    <Sidebar />
    <div className="container-fluid p-0">
      <About about={data.about} config={config} />

      <hr className="m-0" />

      <Experience experiences={data.experiences} />

      <hr className="m-0" />

      <Education educations={data.educations} />

      <hr className="m-0" />

      <Skills
        competenceSkills={config.competenceSkills}
        languageSkills={data.languageSkills}
      />

      {/* <hr className="m-0" />

      <section
        className="resume-section p-3 p-lg-5 d-flex align-items-center"
        id="skills"
      >
        <div className="w-100">
          <h2 className="mb-5">Skills</h2>

          <div className="subheading mb-3">
            Programming Languages &amp; Tools
          </div>
          <ul className="list-inline dev-icons">
            <li className="list-inline-item">
              <i className="fab fa-html5"></i>
            </li>
            <li className="list-inline-item">
              <i className="fab fa-css3-alt"></i>
            </li>
            <li className="list-inline-item">
              <i className="fab fa-js-square"></i>
            </li>
            <li className="list-inline-item">
              <i className="fab fa-angular"></i>
            </li>
            <li className="list-inline-item">
              <i className="fab fa-react"></i>
            </li>
            <li className="list-inline-item">
              <i className="fab fa-node-js"></i>
            </li>
            <li className="list-inline-item">
              <i className="fab fa-sass"></i>
            </li>
            <li className="list-inline-item">
              <i className="fab fa-less"></i>
            </li>
            <li className="list-inline-item">
              <i className="fab fa-wordpress"></i>
            </li>
            <li className="list-inline-item">
              <i className="fab fa-gulp"></i>
            </li>
            <li className="list-inline-item">
              <i className="fab fa-grunt"></i>
            </li>
            <li className="list-inline-item">
              <i className="fab fa-npm"></i>
            </li>
          </ul>

          <div className="subheading mb-3">Workflow</div>
          <ul className="fa-ul mb-0">
            <li>
              <i className="fa-li fa fa-check"></i>
              Mobile-First, Responsive Design
            </li>
            <li>
              <i className="fa-li fa fa-check"></i>
              Cross Browser Testing &amp; Debugging
            </li>
            <li>
              <i className="fa-li fa fa-check"></i>
              Cross Functional Teams
            </li>
            <li>
              <i className="fa-li fa fa-check"></i>
              Agile Development &amp; Scrum
            </li>
          </ul>
        </div>
      </section> */}

      {/* <hr className="m-0" />

      <section
        className="resume-section p-3 p-lg-5 d-flex align-items-center"
        id="interests"
      >
        <div className="w-100">
          <h2 className="mb-5">Interests</h2>
          <p>
            Apart from being a web developer, I enjoy most of my time being
            outdoors. In the winter, I am an avid skier and novice ice climber.
            During the warmer months here in Colorado, I enjoy mountain biking,
            free climbing, and kayaking.
          </p>
          <p className="mb-0">
            When forced indoors, I follow a number of sci-fi and fantasy genre
            movies and television shows, I am an aspiring chef, and I spend a
            large amount of my free time exploring the latest technology
            advancements in the front-end web development world.
          </p>
        </div>
      </section>

      <hr className="m-0" />

      <section
        className="resume-section p-3 p-lg-5 d-flex align-items-center"
        id="awards"
      >
        <div className="w-100">
          <h2 className="mb-5">Awards &amp; Certifications</h2>
          <ul className="fa-ul mb-0">
            <li>
              <i className="fa-li fa fa-trophy text-warning"></i>
              Google Analytics Certified Developer
            </li>
            <li>
              <i className="fa-li fa fa-trophy text-warning"></i>
              Mobile Web Specialist - Google Certification
            </li>
            <li>
              <i className="fa-li fa fa-trophy text-warning"></i>1<sup>st</sup>
              Place - University of Colorado Boulder - Emerging Tech Competition
              2009
            </li>
            <li>
              <i className="fa-li fa fa-trophy text-warning"></i>1<sup>st</sup>
              Place - University of Colorado Boulder - Adobe Creative Jam 2008
              (UI Design Category)
            </li>
            <li>
              <i className="fa-li fa fa-trophy text-warning"></i>2<sup>nd</sup>
              Place - University of Colorado Boulder - Emerging Tech Competition
              2008
            </li>
            <li>
              <i className="fa-li fa fa-trophy text-warning"></i>1<sup>st</sup>
              Place - James Buchanan High School - Hackathon 2006
            </li>
            <li>
              <i className="fa-li fa fa-trophy text-warning"></i>3<sup>rd</sup>
              Place - James Buchanan High School - Hackathon 2005
            </li>
          </ul>
        </div>
      </section> */}
    </div>
  </Layout>
);

export const pageQuery = graphql`
  query educations($language: String) {
    about: markdownRemark(
      fields: { sourceName: { eq: "content" }, locale: { eq: $language } }
      fileAbsolutePath: { regex: "//about.+\\\\.md$/" }
    ) {
      html
      frontmatter {
        birthdate
        firstExperienceDate
      }
    }

    educations: allMarkdownRemark(
      filter: {
        fields: { sourceName: { eq: "educations" }, locale: { eq: $language } }
      }
      sort: { fields: frontmatter___date, order: DESC }
    ) {
      nodes {
        id
        html
        frontmatter {
          institution
          studyType
          area
          gpa
          date
        }
      }
    }
    experiences: allMarkdownRemark(
      filter: {
        fields: { sourceName: { eq: "experiences" }, locale: { eq: $language } }
      }
      sort: { fields: frontmatter___date, order: DESC }
    ) {
      nodes {
        id
        html
        frontmatter {
          title
          date
          company
        }
      }
    }
    languageSkills: markdownRemark(
      fields: { sourceName: { eq: "content" }, locale: { eq: $language } }
      fileAbsolutePath: { regex: "//language-skills/" }
    ) {
      html
      frontmatter {
        languages {
          level {
            title
            value
          }
          lang
        }
      }
    }
  }
`;

export default IndexPage;
